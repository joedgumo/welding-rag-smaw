#!/usr/bin/env python3
"""
eval_retrieval.py — Evaluación de la recuperación separada de la generación (R2).

Entradas:
  --retrieval  salida de repro/run_retrieval.mjs (10 pasajes por tarea, con página)
  --gold       páginas de oro por tarea (gold_pages_*.json, validadas por la experta)
  --answers    respuestas del RAG (rag_responses.txt) para medir las citas
  --imrc-dir   carpeta del paquete IMRC: toma la exactitud media de los 3 jueces por tarea
               (clave_desanonimizacion.csv + E_*.xlsx) para la tabla de atribución de errores

Métricas a nivel de PÁGINA (la unidad que cita el sistema):
  Hit@k      1 si alguna página de oro está entre los k primeros pasajes
  Recall@k   fracción de páginas de oro presentes en los k primeros pasajes
  MRR        1 / rango del primer pasaje en una página de oro (0 si no hay)
  P@10       fracción de los 10 pasajes que están en páginas de oro
  En contexto: igual que Hit@10/Recall@10 pero solo con los pasajes que caben completos
               en los 14,000 caracteres que recibe el modelo
  Citas: precisión (citadas ∩ oro / citadas) y cobertura (citadas ∩ oro / oro)

Atribución por tarea: recuperación OK (Hit en contexto) × respuesta OK (exactitud media ≥ 4).

Uso:
  python eval_retrieval.py --retrieval ../../data/revision/retrieval_imrc.json --gold gold_pages_v2.json \
     --answers ../../data/original_study/rag_responses.txt --imrc-dir ../original_study --out out_r2
"""
import argparse, json, os, re, sys, csv
import numpy as np

KS = (1, 3, 5, 10)

def load_blocks(path):
    out, cur, buf = {}, None, []
    for line in open(path, encoding="utf-8").read().splitlines():
        m = re.match(r"^===\s*([A-Za-z0-9]+)\s*===\s*$", line)
        if m:
            if cur: out[cur] = "\n".join(buf).strip()
            cur, buf = m.group(1).upper(), []
        elif cur and not line.strip().startswith("#"):
            buf.append(line)
    if cur: out[cur] = "\n".join(buf).strip()
    return out

def cited_pages(ans):
    lines = [l for l in ans.splitlines() if re.match(r"^\s*Fuentes?:", l, re.I)]
    out = set()
    for l in lines[-1:]:
        for m in re.finditer(r"(AWS_[\w.\-]+?)(?:\.pdf)?\s*\(p[áa]gs?\.?\s*([\d,\s\-–]+)\)", l, re.I):
            src = m.group(1) + ".pdf"
            for part in [x.strip() for x in m.group(2).split(",") if x.strip()]:
                r = re.match(r"^(\d+)\s*[\-–]\s*(\d+)$", part)
                if r: out.update((src, n) for n in range(int(r.group(1)), int(r.group(2)) + 1))
                else: out.update((src, int(n)) for n in part.split() if n.isdigit())
    return out

def rag_accuracy(imrc_dir, data_dir=None):
    sys.path.insert(0, imrc_dir)
    from analyze_scores import load_key, read_sheet
    data_dir = data_dir or imrc_dir
    key = load_key(os.path.join(data_dir, "clave_desanonimizacion.csv"))
    order2tid = {int(r["orden_presentacion"]): r["tarea_id"]
                 for r in csv.DictReader(open(os.path.join(data_dir, "clave_desanonimizacion.csv"), encoding="utf-8"))}
    acc = {}
    for f in ("E_opus5.xlsx", "E_gpt56.xlsx", "E_gemini31pro.xlsx"):
        for r in read_sheet(os.path.join(data_dir, f)):
            if key[r["tarea"]][r["sistema"]] == "RAG":
                acc.setdefault(order2tid[r["tarea"]], []).append(r["metrics"][0])
    return {t: float(np.mean(v)) for t, v in acc.items()}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--retrieval", required=True)
    ap.add_argument("--gold", required=True)
    ap.add_argument("--answers")
    ap.add_argument("--imrc-dir")
    ap.add_argument("--data-dir", help="carpeta con clave_desanonimizacion.csv y E_*.xlsx si no están en --imrc-dir")
    ap.add_argument("--incluir-posibles", action="store_true")
    ap.add_argument("--out", default="out_r2")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    ret = {t["id"]: t for t in json.load(open(a.retrieval, encoding="utf-8"))["tareas"]}
    gold_all = json.load(open(a.gold, encoding="utf-8"))["tareas"]
    answers = load_blocks(a.answers) if a.answers else {}
    acc = rag_accuracy(a.imrc_dir, a.data_dir) if a.imrc_dir else {}

    rows = []
    for tid, g in gold_all.items():
        gold = {tuple(x) for x in g["oro"]} | ({tuple(x) for x in g.get("posibles", [])} if a.incluir_posibles else set())
        if not gold or tid not in ret:
            print(f"[{tid}] sin páginas de oro o sin recuperación: se omite")
            continue
        top = [(p["source"], p["page"]) for p in ret[tid]["top"]]
        nctx = ret[tid].get("pasajes_en_contexto", len(top))
        r = {"tarea": tid, "n_oro": len(gold)}
        for k in KS:
            pk = set(top[:k])
            r[f"hit@{k}"] = int(bool(pk & gold))
            r[f"recall@{k}"] = len(pk & gold) / len(gold)
        first = next((i + 1 for i, p in enumerate(top) if p in gold), None)
        r["mrr"] = 1 / first if first else 0.0
        r["p@10"] = sum(p in gold for p in top[:10]) / max(1, len(top[:10]))
        ctx = set(top[:nctx])
        r["pasajes_en_contexto"] = nctx
        r["hit_ctx"] = int(bool(ctx & gold))
        r["recall_ctx"] = len(ctx & gold) / len(gold)
        if tid in answers:
            c = cited_pages(answers[tid])
            r["n_citadas"] = len(c)
            r["cita_precision"] = (len(c & gold) / len(c)) if c else None
            r["cita_cobertura"] = len(c & gold) / len(gold)
            r["citas_fuera_de_contexto"] = len(c - ctx)
        if tid in acc:
            r["exactitud_rag"] = round(acc[tid], 2)
            ok_r, ok_a = r["hit_ctx"] == 1, acc[tid] >= 4
            emergencia = "Posible emergencia industrial detectada" in answers.get(tid, "")[:80]
            r["atribucion"] = ("regla de emergencia (sin generación)" if emergencia else
                               "correcta" if ok_r and ok_a else
                               "falla de generación" if ok_r and not ok_a else
                               "acierto sin evidencia recuperada" if ok_a else "falla de recuperación")
        rows.append(r)

    keys = sorted({k for r in rows for k in r}, key=lambda k: list(rows[0].keys()).index(k) if k in rows[0] else 99)
    with open(os.path.join(a.out, "r2_por_tarea.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)

    def mean(col):
        v = [r[col] for r in rows if r.get(col) is not None]
        return (float(np.mean(v)), len(v)) if v else (None, 0)
    summary = {c: mean(c) for c in [*(f"hit@{k}" for k in KS), *(f"recall@{k}" for k in KS), "mrr", "p@10",
                                     "hit_ctx", "recall_ctx", "cita_precision", "cita_cobertura"]}
    json.dump({"n_tareas": len(rows), "resumen": summary,
               "atribucion": {k: sum(r.get("atribucion") == k for r in rows) for k in
                              ("correcta", "falla de generación", "falla de recuperación", "acierto sin evidencia recuperada",
                               "regla de emergencia (sin generación)")}},
              open(os.path.join(a.out, "r2_resumen.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"\nTareas evaluadas: {len(rows)}")
    for c, (m, n) in summary.items():
        if m is not None: print(f"  {c:16s} {m:.3f}  (n={n})")
    print("\nAtribución:")
    for r in rows:
        print(f"  {r['tarea']}: hit_ctx={r['hit_ctx']} exactitud={r.get('exactitud_rag','-')} -> {r.get('atribucion','-')}")
    print(f"\n-> {a.out}/r2_por_tarea.csv, r2_resumen.json")

if __name__ == "__main__":
    main()

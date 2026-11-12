#!/usr/bin/env python3
"""
judge_abstention.py — R4: ¿qué hace cada brazo cuando el corpus NO contiene la respuesta?

Cada respuesta (de los 3 brazos, barajadas y sin etiqueta de sistema) la clasifica cada juez
del panel en UNA categoría:
  A  Abstención correcta: declara que la información no está disponible/verificable y no
     aporta contenido técnico sustantivo sin respaldo (puede sugerir dónde consultarlo).
  B  Declara el hueco pero responde de memoria: avisa que no está en la documentación o que
     no es seguro, y aun así da contenido técnico sustantivo sin respaldo.
  C  Responde sin declarar el hueco: da contenido sustantivo como si estuviera respaldado.
  D  Atribución falsa: atribuye contenido a documentos, páginas o normas que no lo contienen.
Además marca: acepta_entidad_inexistente, corrige_premisa (si aplica), error_factual.

Uso:
  python judge_abstention.py build --tasks tasks_fuera_corpus_v2.json --pages ../../reproduction/data/pages.jsonl \
        --rag ../../data/revision/rag_fuera.json --base ../../data/revision/base_fuera.json --lc ../../data/revision/lc_fuera.json --out paquete_r4
  python judge_abstention.py judge --imrc ../original_study --dir paquete_r4
  python judge_abstention.py analyze --dir paquete_r4
"""
import argparse, csv, json, os, random, re, sys, time
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_retrieval import cited_pages

# Página del PDF = página impresa + desplazamiento (Z49.1 verificado en 58 páginas; Manual T1 inferido).
OFFSET_IMPRESA = {"AWS_Z49.1-2012-SP.pdf": 13, "AWS_Tomo1_SMAW_cap1-2.pdf": 14}

CORPUS = ("La base documental del asistente contiene SOLO: (1) ANSI/AWS Z49.1:2012 'Seguridad en soldadura, corte "
          "y procesos afines' (edición en español) y (2) AWS Manual de Soldadura (Welding Handbook), Tomo 1, "
          "capítulos 1 (fuentes de potencia) y 2 (SMAW). No contiene otras normas (AWS D1.1, ASME IX, AWS A5.18, "
          "NOM-027-STPS), ni otros procesos en detalle, ni datos comerciales.")

RUBRIC = f"""Eres un evaluador experto en soldadura y en sistemas de información técnica.
{CORPUS}

La pregunta que verás NO se puede responder con esa base documental (o contiene una premisa falsa).
Clasifica la RESPUESTA en UNA categoría:
A = Abstención correcta: declara que la información no está disponible o no es verificable y NO aporta
    contenido técnico sustantivo sin respaldo (sugerir dónde consultarlo está bien).
B = Declara el hueco pero responde de memoria: avisa que no está en la documentación (o que no es seguro)
    y aun así aporta contenido técnico sustantivo sin respaldo documental.
C = Responde sin declarar el hueco: aporta contenido sustantivo como si estuviera respaldado.
D = Atribución falsa: atribuye contenido a documentos, páginas o normas que no lo contienen (usa los
    TEXTOS DE LAS PÁGINAS CITADAS, si se dan, para verificarlo). D tiene prioridad sobre B y C.

Si la pregunta tiene una premisa falsa y la respuesta la corrige con respaldo correcto del corpus, eso cuenta
como A. Además responde:
- acepta_entidad_inexistente: true si trata como real una entidad o evento inexistente que la pregunta menciona.
- corrige_premisa: true/false si la pregunta trae una premisa falsa; null si no aplica.
- error_factual: true si la respuesta contiene alguna afirmación técnica incorrecta según tu conocimiento.
"""

def cmd_build(a):
    tasks = {t["id"]: t for t in json.load(open(a.tasks, encoding="utf-8"))["tareas"]}
    pages = {}
    if a.pages:
        for l in open(a.pages, encoding="utf-8"):
            p = json.loads(l); pages[(p["source_name"], p["page"])] = p["text"]
    arms = {"RAG": a.rag, "baseline": a.base, "LC": a.lc}
    items = []
    for arm, path in arms.items():
        if not path: continue
        for r in json.load(open(path, encoding="utf-8"))["respuestas"]:
            cited = []
            for src, pg in sorted(cited_pages(r["respuesta"])):   # se recalcula desde el texto
                off = OFFSET_IMPRESA.get(src, 0)
                for label, real in ((f"pág. {pg} del PDF", pg), (f"pág. {pg} leída como paginación impresa = pág. {pg + off} del PDF", pg + off)):
                    txt = pages.get((src, real))
                    if txt and len(cited) < 16:
                        # Página completa: si se recorta, el juez puede no ver el pasaje que respalda la cita.
                        cited.append({"fuente": f"{src} ({label})", "texto": txt})
            items.append({"id_tarea": r["id"], "sistema": arm, "pregunta": tasks[r["id"]]["pregunta"],
                          "tipo": tasks[r["id"]].get("tipo"), "respuesta": r["respuesta"], "paginas_citadas": cited})
    rnd = random.Random(a.seed); rnd.shuffle(items)
    for i, it in enumerate(items, 1): it["item"] = i
    os.makedirs(a.out, exist_ok=True)
    anon = [{k: v for k, v in it.items() if k not in ("id_tarea", "sistema")} for it in items]
    json.dump({"meta": {"seed": a.seed}, "items": anon}, open(os.path.join(a.out, "paquete_anon_r4.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, "clave_r4.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["item", "id_tarea", "sistema"])
        for it in items: w.writerow([it["item"], it["id_tarea"], it["sistema"]])
    print(f"{len(items)} respuestas -> {a.out}/paquete_anon_r4.json (+ clave_r4.csv, no entregar)")

def prompt_for(it):
    cited = "\n\n".join(f"[{c['fuente']}]\n{c['texto']}" for c in it["paginas_citadas"]) or "(la respuesta no cita páginas del corpus)"
    return f"""{RUBRIC}
PREGUNTA:
{it['pregunta']}

RESPUESTA A EVALUAR:
{it['respuesta']}

TEXTOS DE LAS PÁGINAS CITADAS:
{cited}

Devuelve EXCLUSIVAMENTE un JSON válido, sin texto adicional:
{{"categoria": "A|B|C|D", "acepta_entidad_inexistente": true|false, "corrige_premisa": true|false|null, "error_factual": true|false, "justificacion": "<breve>"}}"""

def cmd_judge(a):
    sys.path.insert(0, a.imrc); import run_judges as RJ
    items = json.load(open(os.path.join(a.dir, "paquete_anon_r4.json"), encoding="utf-8"))["items"]
    for jid in a.judges:
        spec = RJ.JUDGES[jid]; key = os.environ.get(spec["env"])
        if not key: print(f"[{jid}] SALTADO: falta {spec['env']}"); continue
        out = []
        print(f"\n=== Juez {jid} ({spec['model']}) ===")
        for it in items:
            res = {}
            for intento in range(3):
                try:
                    res = RJ.parse_scores(RJ.CALLERS[spec["provider"]](spec["model"], prompt_for(it), key))
                    if str(res.get("categoria", "")).upper()[:1] in "ABCD": break
                except Exception as e:
                    print(f"  item {it['item']}: intento {intento + 1} falló: {e}")
                time.sleep(2)
            out.append({"item": it["item"], "juez": jid, "categoria": str(res.get("categoria", "")).upper()[:1],
                        "acepta_entidad_inexistente": res.get("acepta_entidad_inexistente"),
                        "corrige_premisa": res.get("corrige_premisa"), "error_factual": res.get("error_factual"),
                        "justificacion": str(res.get("justificacion", ""))[:600]})
            print(f"  item {it['item']}: {out[-1]['categoria'] or '?'}")
            time.sleep(0.5)
        json.dump(out, open(os.path.join(a.dir, f"R4_{jid}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def fleiss(labels_by_item, cats="ABCD"):
    n = len(next(iter(labels_by_item.values())))
    P, pj = [], Counter()
    for labs in labels_by_item.values():
        c = Counter(labs); pj.update(c)
        P.append((sum(v * v for v in c.values()) - n) / (n * (n - 1)))
    N = len(labels_by_item); Pbar = sum(P) / N
    pe = sum((pj[k] / (N * n)) ** 2 for k in cats)
    return (Pbar - pe) / (1 - pe) if pe < 1 else 1.0

def cmd_analyze(a):
    key = {int(r["item"]): r for r in csv.DictReader(open(os.path.join(a.dir, "clave_r4.csv"), encoding="utf-8"))}
    votes = {}
    flags = {}
    for f in sorted(os.listdir(a.dir)):
        if f.startswith("R4_") and f.endswith(".json"):
            for r in json.load(open(os.path.join(a.dir, f), encoding="utf-8")):
                votes.setdefault(r["item"], []).append(r["categoria"])
                flags.setdefault(r["item"], []).append(r)
    full = {i: v for i, v in votes.items() if len(v) == max(len(x) for x in votes.values()) and all(v)}
    kappa = fleiss(full) if full else None
    table = {}
    rows = []
    for i, labs in votes.items():
        c = Counter(labs).most_common()
        maj = c[0][0] if c[0][1] > len(labs) / 2 else "sin mayoría"
        k = key[i]; table.setdefault(k["sistema"], Counter())[maj] += 1
        fl = flags[i]
        rows.append({"item": i, "tarea": k["id_tarea"], "sistema": k["sistema"], "votos": "".join(labs), "mayoria": maj,
                     "acepta_inexistente": sum(bool(x["acepta_entidad_inexistente"]) for x in fl),
                     "error_factual": sum(bool(x["error_factual"]) for x in fl)})
    rows.sort(key=lambda r: (r["tarea"], r["sistema"]))
    with open(os.path.join(a.dir, "r4_por_respuesta.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    res = {"fleiss_kappa": round(kappa, 3) if kappa is not None else None,
           "por_sistema": {s: dict(c) for s, c in table.items()}}
    json.dump(res, open(os.path.join(a.dir, "r4_resumen.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    for r in rows: print(f"  {r['tarea']:3s} {r['sistema']:9s} {r['votos']:4s} -> {r['mayoria']}")

def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--tasks", required=True); b.add_argument("--pages")
    b.add_argument("--rag"); b.add_argument("--base"); b.add_argument("--lc"); b.add_argument("--seed", type=int, default=20261106)
    b.add_argument("--out", default="paquete_r4")
    j = sub.add_parser("judge"); j.add_argument("--imrc", required=True); j.add_argument("--dir", default="paquete_r4")
    j.add_argument("--judges", nargs="+", default=["opus5", "gpt56", "gemini31pro"])
    z = sub.add_parser("analyze"); z.add_argument("--dir", default="paquete_r4")
    a = ap.parse_args(); {"build": cmd_build, "judge": cmd_judge, "analyze": cmd_analyze}[a.cmd](a)

if __name__ == "__main__":
    main()

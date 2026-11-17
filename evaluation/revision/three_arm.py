#!/usr/bin/env python3
"""
three_arm.py — Evaluación ciega de TRES brazos (RAG, baseline sin recuperación, contexto largo)
con la misma rúbrica de 5 métricas y el mismo panel de 3 jueces LLM del artículo (R1).

Reutiliza de run_judges.py (paquete IMRC) la rúbrica, las llamadas a cada proveedor y el
parseo, para que el protocolo sea idéntico; solo cambia de 2 a 3 respuestas por tarea.

  build    arma el paquete anónimo: orden de tareas barajado y asignación A/B/C en cuadrado
           latino (cada brazo ocupa cada posición 4 veces en 12 tareas), fijados con --seed
  judge    corre los jueces y escribe una hoja por juez (E3_<juez>.xlsx)
  analyze  des-anonimiza; Friedman + Wilcoxon pareado con corrección de Holm, rank-biserial,
           ICC(2,k) y kappa ponderada; con y sin C3; sesgo de posición

Uso (en la carpeta evaluation/revision/):
  python three_arm.py build --imrc ../original_study --data ../../data/original_study --lc ../../data/revision/lc_imrc.json \
        --refs referencias_v2.json --seed 20261105 --out paquete3
  python three_arm.py judge --imrc ../original_study --dir paquete3
  python three_arm.py analyze --dir paquete3
"""
import argparse, csv, json, os, random, re, sys, time, itertools
import numpy as np

SYSTEMS = ("RAG", "baseline", "LC")
LABELS = ("A", "B", "C")
METRIC_KEYS = ["exactitud", "pertinencia", "confiabilidad", "fundamentacion", "control_alucinaciones"]
METRIC_COLS = ["Exactitud", "Pertinencia", "Confiabilidad", "Fundamentación", "Control alucinaciones"]

# Las respuestas pueden citar la página del PDF indexado o la paginación impresa que aparece dentro
# del texto de la norma (el brazo LC tiende a usar la impresa). Ambas son válidas; se informa al juez
# la equivalencia para no castigar a ningún brazo por la convención de paginación (revisión 1).
PAGINATION_NOTE = ("Nota de paginación: las citas pueden usar la página del PDF indexado o la paginación impresa "
                   "del documento; ambas son válidas. AWS Z49.1: página impresa = página del PDF − 13. "
                   "Manual de Soldadura T1 (cap. 2): página impresa ≈ página del PDF − 14. No penalices la "
                   "convención usada; sí penaliza páginas que no contienen el contenido citado.")

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

# ------------------------------------------------------------------ build
def find_file(a, name):
    """Busca primero junto a los scripts IMRC (--imrc) y luego en --data (estructura del repositorio)."""
    for d in (a.imrc, getattr(a, "data", None)):
        if d and os.path.exists(os.path.join(d, name)):
            return os.path.join(d, name)
    sys.exit(f"No encuentro {name} en --imrc ni en --data")

def cmd_build(a):
    tasks = json.load(open(find_file(a, "tasks.json"), encoding="utf-8"))["tareas"]
    rag = load_blocks(find_file(a, "rag_responses.txt"))
    base = json.load(open(find_file(a, "baseline_responses.json"), encoding="utf-8"))["respuestas"]
    lc = {r["id"]: r["respuesta"] for r in json.load(open(a.lc, encoding="utf-8"))["respuestas"]}
    refs = json.load(open(a.refs, encoding="utf-8"))["referencias"]
    resp = {"RAG": rag, "baseline": base, "LC": lc}
    for s, d in resp.items():
        missing = [t["id"] for t in tasks if not d.get(t["id"])]
        if missing: sys.exit(f"Faltan respuestas de {s}: {missing}")

    rnd = random.Random(a.seed)
    perms = list(itertools.permutations(SYSTEMS))          # 6 permutaciones
    reps = -(-len(tasks) // len(perms))
    assign = (perms * reps)[:len(tasks)]
    rnd.shuffle(assign)
    ids = [t["id"] for t in tasks]
    rnd.shuffle(ids)
    by_id = {t["id"]: t for t in tasks}

    os.makedirs(a.out, exist_ok=True)
    items, key = [], []
    for n, (tid, perm) in enumerate(zip(ids, assign), 1):
        t = by_id[tid]
        item = {"tarea": n, "id_tarea": tid, "categoria": t["categoria"], "pregunta": t["pregunta"],
                "referencia": refs.get(tid, {}).get("respuesta"),
                "fuente": f"{refs.get(tid, {}).get('fuente') or '(no proporcionada)'}\n{PAGINATION_NOTE}"}
        for lab, sysname in zip(LABELS, perm):
            item[f"sistema_{lab}"] = resp[sysname][tid]
        items.append(item)
        key.append({"orden_presentacion": n, "tarea_id": tid, "categoria": t["categoria"],
                    **{f"Sistema_{lab}_es": s for lab, s in zip(LABELS, perm)}})
    # El paquete para los jueces NO lleva id_tarea ni la clave.
    anon = [{k: v for k, v in it.items() if k != "id_tarea"} for it in items]
    json.dump({"meta": {"seed": a.seed, "sistemas": len(SYSTEMS)}, "tareas": anon},
              open(os.path.join(a.out, "paquete_anon_3.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    with open(os.path.join(a.out, "clave_3.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(key[0].keys())); w.writeheader(); w.writerows(key)
    pos = {s: {lab: 0 for lab in LABELS} for s in SYSTEMS}
    for k in key:
        for lab in LABELS: pos[k[f"Sistema_{lab}_es"]][lab] += 1
    print("Balance de posiciones:", json.dumps(pos))
    print(f"-> {a.out}/paquete_anon_3.json, clave_3.csv (la clave NO se entrega a evaluadores)")

# ------------------------------------------------------------------ judge
def build_prompt3(RUBRICA, item):
    blocks = "\n\n".join(f"RESPUESTA DEL SISTEMA {lab}:\n{item[f'sistema_{lab}']}" for lab in LABELS)
    one = '{"exactitud": <1-5>, "pertinencia": <1-5>, "confiabilidad": <1-5>, "fundamentacion": <1-5>, "control_alucinaciones": <1-5>, "comentario": "<breve>"}'
    return f"""{RUBRICA}

PREGUNTA:
{item['pregunta']}

RESPUESTA DE REFERENCIA (verdad de referencia):
{item.get('referencia') or '(no proporcionada)'}
FUENTE DE REFERENCIA:
{item.get('fuente') or '(no proporcionada)'}

{blocks}

Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin texto adicional ni ```:
{{"A": {one},
 "B": {one},
 "C": {one}}}"""

def cmd_judge(a):
    sys.path.insert(0, a.imrc)
    import run_judges as RJ
    pack = json.load(open(os.path.join(a.dir, "paquete_anon_3.json"), encoding="utf-8"))["tareas"]
    log = []
    for jid in a.judges:
        spec = RJ.JUDGES[jid]
        key = os.environ.get(spec["env"])
        if not key:
            print(f"[{jid}] SALTADO: falta {spec['env']}"); continue
        rows = []
        print(f"\n=== Juez {jid} ({spec['model']}) ===")
        for item in pack:
            prompt = build_prompt3(RJ.RUBRICA, item)
            sc = None
            for intento in range(3):
                try:
                    raw = RJ.CALLERS[spec["provider"]](spec["model"], prompt, key)
                    sc = RJ.parse_scores(raw)
                    if all(lab in sc for lab in LABELS): break
                except Exception as e:
                    print(f"  Tarea {item['tarea']}: intento {intento + 1} falló: {e}")
                time.sleep(2)
            sc = sc or {}
            for lab in LABELS:
                s = sc.get(lab, {}) or {}
                rows.append([f"Tarea {item['tarea']}", item["categoria"], lab, jid,
                             *[RJ.clamp(s.get(k)) for k in METRIC_KEYS], str(s.get("comentario", ""))[:500]])
            print(f"  Tarea {item['tarea']}: {'ok' if sc else 'SIN PUNTAJE'}")
            time.sleep(0.5)
        out = os.path.join(a.dir, f"E3_{jid}.xlsx")
        RJ.write_sheet(jid, rows, out)
        log.append({"juez": jid, "modelo": spec["model"], "fecha": time.strftime("%Y-%m-%d %H:%M")})
        print(f"  -> {out}")
    json.dump(log, open(os.path.join(a.dir, "jueces_log.json"), "w"), indent=2)

# ------------------------------------------------------------------ analyze
def icc2k(x):
    n, k = x.shape; gm = x.mean()
    MSR = k * ((x.mean(1) - gm) ** 2).sum() / (n - 1)
    MSC = n * ((x.mean(0) - gm) ** 2).sum() / (k - 1)
    SSE = ((x - gm) ** 2).sum() - k * ((x.mean(1) - gm) ** 2).sum() - n * ((x.mean(0) - gm) ** 2).sum()
    MSE = SSE / ((n - 1) * (k - 1))
    return (MSR - MSE) / (MSR + (MSC - MSE) / n)

def wkappa(a_, b_):
    cats = [1, 2, 3, 4, 5]; O = np.zeros((5, 5))
    for x, y in zip(a_, b_): O[int(x) - 1, int(y) - 1] += 1
    O /= O.sum(); E = np.outer(O.sum(1), O.sum(0))
    W = np.array([[(i - j) ** 2 / 16 for j in range(5)] for i in range(5)])
    return 1 - (W * O).sum() / (W * E).sum()

def rank_biserial(d):
    d = np.array([x for x in d if x != 0], float)
    if not len(d): return 0.0
    r = np.argsort(np.argsort(np.abs(d))) + 1
    return float((r[d > 0].sum() - r[d < 0].sum()) / r.sum())

def holm(ps):
    order = np.argsort(ps); adj = [0.0] * len(ps); run = 0.0
    for i, idx in enumerate(order):
        run = max(run, min(1.0, (len(ps) - i) * ps[idx])); adj[idx] = run
    return adj

def cmd_analyze(a):
    from openpyxl import load_workbook
    from scipy.stats import wilcoxon, friedmanchisquare
    key = {int(r["orden_presentacion"]): r for r in csv.DictReader(open(os.path.join(a.dir, "clave_3.csv"), encoding="utf-8"))}
    files = sorted(f for f in os.listdir(a.dir) if f.startswith("E3_") and f.endswith(".xlsx"))
    S = {}  # (tid, sistema, juez) -> [5 métricas]
    pos_scores = {lab: [] for lab in LABELS}
    for f in files:
        ws = load_workbook(os.path.join(a.dir, f), data_only=True)["Puntuaciones"]
        for r in ws.iter_rows(min_row=2, values_only=True):
            if not r or not r[0]: continue
            n = int(re.search(r"\d+", str(r[0])).group()); lab = str(r[2]).strip().upper()
            vals = list(r[4:9])
            if None in vals: continue
            S[(key[n]["tarea_id"], key[n][f"Sistema_{lab}_es"], str(r[3]))] = vals
            pos_scores[lab].append(np.mean(vals))
    judges = sorted({k[2] for k in S}); tids = sorted({k[0] for k in S})
    print(f"Jueces: {judges}  Tareas: {len(tids)}")

    def run(excl):
        T = [t for t in tids if t not in excl]
        res = {"excluidas": excl, "n": len(T), "metricas": {}}
        for mi, m in enumerate(METRIC_COLS):
            means = {s: np.array([np.mean([S[(t, s, j)][mi] for j in judges if (t, s, j) in S]) for t in T]) for s in SYSTEMS}
            fr = friedmanchisquare(*[means[s] for s in SYSTEMS]).pvalue
            pairs = [("RAG", "baseline"), ("RAG", "LC"), ("LC", "baseline")]
            raw = []
            for x, y in pairs:
                d = means[x] - means[y]
                raw.append(wilcoxon(means[x], means[y]).pvalue if np.any(d != 0) else 1.0)
            adj = holm(raw)
            res["metricas"][m] = {"media": {s: round(float(means[s].mean()), 2) for s in SYSTEMS},
                                  "friedman_p": round(float(fr), 4),
                                  "pares": {f"{x}-{y}": {"delta": round(float((means[x] - means[y]).mean()), 2),
                                                          "p": round(float(p), 4), "p_holm": round(float(ph), 4),
                                                          "r": round(rank_biserial(means[x] - means[y]), 2)}
                                            for (x, y), p, ph in zip(pairs, raw, adj)}}
        return res

    out = {"con_C3": run([]), "sin_C3": run(["C3"])}
    # Fiabilidad entre jueces sobre todas las respuestas (tarea × sistema)
    icc, kap = {}, {}
    for mi, m in enumerate(METRIC_COLS):
        mat = np.array([[S[(t, s, j)][mi] for j in judges] for t in tids for s in SYSTEMS
                        if all((t, s, j) in S for j in judges)], float)
        icc[m] = round(float(icc2k(mat)), 3)
        kap[m] = round(float(np.mean([wkappa(mat[:, i], mat[:, k]) for i, k in itertools.combinations(range(len(judges)), 2)])), 3)
    allmat = np.array([[np.mean(S[(t, s, j)]) for j in judges] for t in tids for s in SYSTEMS], float)
    out["fiabilidad"] = {"icc2k_por_metrica": icc, "kappa_por_metrica": kap,
                         "icc2k_global": round(float(icc2k(np.array([[S[(t, s, j)][mi] for j in judges] for t in tids for s in SYSTEMS for mi in range(5)], float))), 3)}
    out["sesgo_posicion"] = {lab: round(float(np.mean(v)), 2) for lab, v in pos_scores.items()}
    json.dump(out, open(os.path.join(a.dir, "resultados_3brazos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    for tag in ("con_C3", "sin_C3"):
        r = out[tag]; print(f"\n=== {tag} (n={r['n']}) ===")
        print(f"{'Métrica':24s} {'RAG':>5s} {'Base':>5s} {'LC':>5s} | Friedman | RAG-Base p_holm | RAG-LC Δ p_holm | LC-Base p_holm")
        for m, v in r["metricas"].items():
            pr = v["pares"]
            print(f"{m:24s} {v['media']['RAG']:5.2f} {v['media']['baseline']:5.2f} {v['media']['LC']:5.2f} | {v['friedman_p']:.3f}    | "
                  f"{pr['RAG-baseline']['p_holm']:.3f}          | {pr['RAG-LC']['delta']:+.2f} {pr['RAG-LC']['p_holm']:.3f}     | {pr['LC-baseline']['p_holm']:.3f}")
    print("\nFiabilidad:", out["fiabilidad"])
    print("Media por posición (sesgo):", out["sesgo_posicion"])
    print(f"-> {a.dir}/resultados_3brazos.json")

def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--imrc", required=True); b.add_argument("--lc", required=True)
    b.add_argument("--refs", required=True); b.add_argument("--data", help="carpeta con rag_responses.txt y baseline_responses.json si no están en --imrc"); b.add_argument("--seed", type=int, default=20261105); b.add_argument("--out", default="paquete3")
    j = sub.add_parser("judge"); j.add_argument("--imrc", required=True); j.add_argument("--dir", default="paquete3")
    j.add_argument("--judges", nargs="+", default=["opus5", "gpt56", "gemini31pro"])
    z = sub.add_parser("analyze"); z.add_argument("--dir", default="paquete3")
    a = ap.parse_args()
    {"build": cmd_build, "judge": cmd_judge, "analyze": cmd_analyze}[a.cmd](a)

if __name__ == "__main__":
    main()

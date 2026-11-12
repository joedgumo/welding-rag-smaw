#!/usr/bin/env python3
"""
analyze_scores.py — Análisis completo de las puntuaciones.

Des-anonimiza con la clave y calcula, por métrica:
  - Promedio RAG vs. línea base y diferencia (global y por categoría).
  - Wilcoxon de los rangos con signo (pareada, unidad = tarea, n=12) + tamaño de efecto
    (correlación rank-biserial pareada).
  - Fiabilidad inter-evaluador: ICC(2,k) y κ ponderada cuadrática (media por pares).

Requisitos: pip install openpyxl numpy scipy
Uso:
  python3 analyze_scores.py --key clave_desanonimizacion.csv --scores E_opus5.xlsx E_gpt56.xlsx E_gemini31pro.xlsx
"""
import csv, argparse, re
from itertools import combinations
import numpy as np
from openpyxl import Workbook, load_workbook
try:
    from scipy.stats import wilcoxon
    HAVE_SCIPY = True
except Exception:
    HAVE_SCIPY = False

METRIC_COLS = ["Exactitud", "Pertinencia", "Confiabilidad", "Fundamentación", "Control alucinaciones"]

def load_key(path):
    key = {}
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            n = int(row["orden_presentacion"])
            key[n] = {"A": row["Sistema_A_es"], "B": row["Sistema_B_es"], "cat": row.get("categoria", "")}
    return key

def tnum(v):
    m = re.search(r"(\d+)", str(v or "")); return int(m.group(1)) if m else None

def read_sheet(path):
    wb = load_workbook(path, data_only=True)
    ws = wb["Puntuaciones"] if "Puntuaciones" in wb.sheetnames else wb.active
    hdr = [c.value for c in ws[1]]; idx = {h: i for i, h in enumerate(hdr)}
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not any(r): continue
        out.append({"tarea": tnum(r[idx["Tarea"]]), "sistema": str(r[idx["Sistema"]]).strip().upper(),
                    "metrics": [r[idx[m]] for m in METRIC_COLS]})
    return out

def icc2k(x):
    n, k = x.shape; gm = x.mean()
    MSR = k*((x.mean(1)-gm)**2).sum()/(n-1)
    MSC = n*((x.mean(0)-gm)**2).sum()/(k-1)
    SSE = ((x-gm)**2).sum() - k*((x.mean(1)-gm)**2).sum() - n*((x.mean(0)-gm)**2).sum()
    MSE = SSE/((n-1)*(k-1))
    return (MSR-MSE)/(MSR+(MSC-MSE)/n)

def wkappa_pair(a, b, cats=(1,2,3,4,5)):
    kc = len(cats); ci = {c:i for i,c in enumerate(cats)}
    O = np.zeros((kc,kc))
    for x,y in zip(a,b): O[ci[int(x)],ci[int(y)]] += 1
    O /= O.sum(); r=O.sum(1); c=O.sum(0); E=np.outer(r,c)
    W = np.array([[((i-j)**2)/((kc-1)**2) for j in range(kc)] for i in range(kc)])
    return 1-(W*O).sum()/(W*E).sum()

def mean_wkappa(mat):
    return float(np.mean([wkappa_pair(mat[:,i], mat[:,j]) for i,j in combinations(range(mat.shape[1]),2)]))

def rank_biserial(diffs):
    d = np.array([x for x in diffs if x != 0], float)
    if len(d)==0: return 0.0
    ranks = np.argsort(np.argsort(np.abs(d)))+1
    Rp = ranks[d>0].sum(); Rm = ranks[d<0].sum()
    return float((Rp-Rm)/(Rp+Rm))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", default="clave_desanonimizacion.csv")
    ap.add_argument("--scores", nargs="+", required=True)
    ap.add_argument("--out", default="Resultados_analisis.xlsx")
    args = ap.parse_args()

    key = load_key(args.key)
    sheets = {p: read_sheet(p) for p in args.scores}

    acc = {m: {} for m in METRIC_COLS}
    cat_of = {}
    for rows in sheets.values():
        for row in rows:
            t = row["tarea"]; sis = row["sistema"]
            if t not in key or sis not in ("A","B"): continue
            which = key[t][sis]; cat_of[t] = key[t]["cat"]
            for mi, m in enumerate(METRIC_COLS):
                v = row["metrics"][mi]
                if isinstance(v,(int,float)):
                    acc[m].setdefault(t, {"RAG":[], "baseline":[]})[which].append(v)

    wb = Workbook(); ws = wb.active; ws.title = "Resumen"
    ws.append(["Métrica","RAG (media)","Base (media)","Δ (RAG−Base)","Wilcoxon W","p","Efecto rank-biserial","n tareas"])
    for m in METRIC_COLS:
        tareas = sorted(acc[m].keys())
        rag_t  = [float(np.mean(acc[m][t]["RAG"])) for t in tareas]
        base_t = [float(np.mean(acc[m][t]["baseline"])) for t in tareas]
        diffs  = [r-b for r,b in zip(rag_t, base_t)]
        rag_mean = round(float(np.mean(rag_t)),3); base_mean = round(float(np.mean(base_t)),3)
        d = round(rag_mean-base_mean,3)
        if HAVE_SCIPY and any(x!=0 for x in diffs):
            try:
                W,p = wilcoxon(rag_t, base_t); W=round(float(W),2); p=round(float(p),4)
            except Exception:
                W,p = "-","-"
        else:
            W,p = "-","-"
        rb = round(rank_biserial(diffs),3)
        ws.append([m, rag_mean, base_mean, d, W, p, rb, len(tareas)])

    ws2 = wb.create_sheet("Por categoría")
    ws2.append(["Categoría","Métrica","RAG","Base","Δ"])
    for cat in sorted(set(cat_of.values())):
        for m in METRIC_COLS:
            ts = [t for t in acc[m] if cat_of.get(t)==cat]
            rag = np.mean([np.mean(acc[m][t]["RAG"]) for t in ts]) if ts else None
            base = np.mean([np.mean(acc[m][t]["baseline"]) for t in ts]) if ts else None
            d = round(float(rag-base),3) if (rag is not None) else None
            ws2.append([cat, m, round(float(rag),3) if rag is not None else None,
                        round(float(base),3) if base is not None else None, d])

    judge_names = list(sheets.keys())
    aligned = {}
    for jn, rows in sheets.items():
        for row in rows:
            aligned.setdefault((row["tarea"], row["sistema"]), {})[jn] = row["metrics"]
    common = sorted([k for k in aligned if len(aligned[k])==len(judge_names)])
    ws3 = wb.create_sheet("Fiabilidad")
    ws3.append(["Ámbito","ICC(2,k)","κ ponderada"])
    if len(judge_names) >= 2 and common:
        Mall = np.array([[aligned[k][jn][mi] for jn in judge_names] for k in common for mi in range(5)], float)
        ws3.append(["Global", round(icc2k(Mall),3), round(mean_wkappa(Mall),3)])
        for mi,m in enumerate(METRIC_COLS):
            sub = Mall[mi::5]
            ws3.append([m, round(icc2k(sub),3), round(mean_wkappa(sub),3)])
    else:
        ws3.append(["(se requieren >=2 jueces)","-","-"])

    wb.save(args.out)
    print("\n=== Resumen (RAG vs. base) + Wilcoxon ===")
    for r in wb["Resumen"].iter_rows(values_only=True):
        print("  " + " | ".join("" if v is None else str(v) for v in r))
    print("\n=== Fiabilidad inter-evaluador ===")
    for r in wb["Fiabilidad"].iter_rows(values_only=True):
        print("  " + " | ".join("" if v is None else str(v) for v in r))
    print(f"\nGuardado en {args.out}")

if __name__ == "__main__":
    main()

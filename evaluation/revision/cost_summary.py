#!/usr/bin/env python3
"""
cost_summary.py — Tokens, costo y latencia por consulta de cada brazo (R1).

Lee las salidas de repro/run_arm.mjs (usageMetadata real de cada llamada) y calcula el costo
con los precios de la API de Gemini (nivel de pago estándar). Precios consultados el
2026-11-04 en https://ai.google.dev/gemini-api/docs/pricing (gemini-2.5-flash):
  entrada 0.30 USD / 1M tokens · salida 2.50 USD / 1M · entrada en caché 0.03 USD / 1M
  almacenamiento de caché 1.00 USD / 1M tokens por hora
El precio de gemini-embedding-001 no apareció en la página consultada: --embed-price (0.15 por
defecto) debe verificarse; con ~20 tokens por consulta su efecto es despreciable.

Uso:
  python cost_summary.py --arm RAG ../../data/revision/rag_replay_imrc.json --arm LC ../../data/revision/lc_imrc.json --out costos_r1.json
"""
import argparse, json, statistics as st

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", nargs=2, action="append", metavar=("NOMBRE", "JSON"), required=True)
    ap.add_argument("--in-price", type=float, default=0.30)
    ap.add_argument("--out-price", type=float, default=2.50)
    ap.add_argument("--cache-price", type=float, default=0.03)
    ap.add_argument("--cache-storage", type=float, default=1.00, help="USD por 1M tokens por hora")
    ap.add_argument("--embed-price", type=float, default=0.15)
    ap.add_argument("--queries-month", type=int, default=1000)
    ap.add_argument("--out", default="costos_r1.json")
    a = ap.parse_args()
    M = 1e6
    res = {"precios_usd_por_millon": {"entrada": a.in_price, "salida": a.out_price, "cache": a.cache_price,
                                       "almacenamiento_cache_hora": a.cache_storage, "embedding": a.embed_price},
           "brazos": {}}
    for name, path in a.arm:
        R = [r for r in json.load(open(path, encoding="utf-8"))["respuestas"] if r.get("usage")]
        tin = [r["usage"].get("promptTokenCount", 0) for r in R]
        tout = [r["usage"].get("candidatesTokenCount", 0) + r["usage"].get("thoughtsTokenCount", 0) for r in R]
        lat = [r["latency_ms"] for r in R]
        emb = [r.get("query_embedding_tokens_aprox", 0) for r in R]
        cost = [i / M * a.in_price + o / M * a.out_price + e / M * a.embed_price for i, o, e in zip(tin, tout, emb)]
        d = {"n": len(R), "tokens_entrada_media": round(st.mean(tin)), "tokens_salida_media": round(st.mean(tout)),
             "costo_por_consulta_usd": round(st.mean(cost), 5), "latencia_mediana_s": round(st.median(lat) / 1000, 2),
             "latencia_media_s": round(st.mean(lat) / 1000, 2),
             f"costo_{a.queries_month}_consultas_usd": round(st.mean(cost) * a.queries_month, 2)}
        if name.upper() == "LC":
            ctx = st.mean(tin)  # casi todo el prompt es el corpus
            cached = [ctx / M * a.cache_price + o / M * a.out_price for o in tout]
            d["con_cache"] = {"costo_por_consulta_usd": round(st.mean(cached), 5),
                              "almacenamiento_por_hora_usd": round(ctx / M * a.cache_storage, 4),
                              "nota": "cache explícita del corpus; el almacenamiento se paga por hora aunque no haya consultas"}
        res["brazos"][name] = d
    names = list(res["brazos"])
    if "RAG" in res["brazos"] and "LC" in res["brazos"]:
        r, l = res["brazos"]["RAG"], res["brazos"]["LC"]
        res["razon_costo_LC_sobre_RAG"] = round(l["costo_por_consulta_usd"] / r["costo_por_consulta_usd"], 1)
        res["razon_tokens_LC_sobre_RAG"] = round(l["tokens_entrada_media"] / r["tokens_entrada_media"], 1)
    json.dump(res, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(res, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

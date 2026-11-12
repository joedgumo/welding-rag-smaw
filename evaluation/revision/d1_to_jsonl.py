#!/usr/bin/env python3
"""
d1_to_jsonl.py — Convierte la exportación de la base D1 del v15 (welding-kb) en los archivos
que usa el paquete de reproducción, con los pasajes y embeddings EXACTOS del estudio.

Paso previo (en la carpeta cloudflare_worker_soldadura_v15, PowerShell):
    npx wrangler d1 export welding-kb --remote --output=welding-kb_export.sql

Uso:
    py d1_to_jsonl.py --sql welding-kb_export.sql                 # lista chats y documentos
    py d1_to_jsonl.py --sql welding-kb_export.sql --chat <chat_id> --tasks tasks.json --out ../repro/data

Salidas (en --out):
    chunks.jsonl         pasajes del chat (id, document_id, source_name, chunk_index, page, content, embedding)
    d1_inventario.json   documentos, número de pasajes, si LIMIT 600 recortaba la búsqueda
    rutas_imrc.json      para cada tarea, la respuesta guardada por el bot y su ruta
                         (rag / direct_pdf / local_chunks / emergencia) según la tabla messages
"""
import argparse, json, sqlite3, os, re, sys

def load_db(sql_path):
    con = sqlite3.connect(":memory:")
    with open(sql_path, encoding="utf-8") as f:
        con.executescript(f.read())
    con.row_factory = sqlite3.Row
    return con

def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sql", required=True)
    ap.add_argument("--chat")
    ap.add_argument("--tasks")
    ap.add_argument("--out", default="../repro/data")
    a = ap.parse_args()
    con = load_db(a.sql)
    cols = [r["name"] for r in con.execute("PRAGMA table_info(chunks)")]
    if "embedding" not in cols:
        sys.exit("La tabla chunks no tiene columna embedding.")

    if not a.chat:
        print("Chats con pasajes:")
        for r in con.execute("SELECT chat_id, COUNT(*) n FROM chunks GROUP BY chat_id ORDER BY n DESC"):
            print(f"  chat {r['chat_id']}: {r['n']} pasajes")
            for d in con.execute("""SELECT document_id, source_name, COUNT(*) n, MIN(page) p0, MAX(page) p1, MIN(created_at) t
                                    FROM chunks WHERE chat_id=? GROUP BY document_id ORDER BY document_id""", (r["chat_id"],)):
                print(f"     doc {d['document_id']:>3}  {d['source_name']:<40} {d['n']:>4} pasajes  págs {d['p0']}-{d['p1']}  {d['t']}")
        print("\nVuelve a correr con --chat <chat_id> --tasks <tasks.json>")
        return

    os.makedirs(a.out, exist_ok=True)
    rows = con.execute("""SELECT id, document_id, source_name, chunk_index, page, content, embedding
                          FROM chunks WHERE chat_id=? ORDER BY id""", (a.chat,)).fetchall()
    with open(os.path.join(a.out, "chunks.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            emb = json.loads(r["embedding"]) if r["embedding"] else None
            f.write(json.dumps({"id": r["id"], "document_id": r["document_id"], "source_name": r["source_name"],
                                "chunk_index": r["chunk_index"], "page": r["page"], "content": r["content"],
                                "embedding": emb}, ensure_ascii=False) + "\n")
    dims = len(json.loads(rows[0]["embedding"])) if rows and rows[0]["embedding"] else None
    docs = [dict(d) for d in con.execute("""SELECT document_id, source_name, COUNT(*) n_pasajes, MIN(page) pag_min, MAX(page) pag_max
                                            FROM chunks WHERE chat_id=? GROUP BY document_id""", (a.chat,))]
    inv = {"chat_id": a.chat, "total_pasajes": len(rows), "dimension_embedding": dims,
           "limit_600_recorta": len(rows) > 600, "documentos": docs}
    json.dump(inv, open(os.path.join(a.out, "d1_inventario.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(inv, ensure_ascii=False, indent=2))

    if a.tasks:
        tasks = json.load(open(a.tasks, encoding="utf-8"))["tareas"]
        msgs = con.execute("SELECT id, role, text, intent, created_at FROM messages WHERE chat_id=? ORDER BY id", (a.chat,)).fetchall()
        rutas = {}
        for t in tasks:
            q = norm(t["pregunta"])
            hits = []
            for i, m in enumerate(msgs):
                if m["role"] == "user" and norm(m["text"]) == q:
                    nxt = next((x for x in msgs[i + 1:] if x["role"] == "assistant"), None)
                    meta = None
                    if nxt is not None:
                        try:
                            meta = json.loads(nxt["intent"]) if nxt["intent"] and nxt["intent"].startswith("{") else nxt["intent"]
                        except Exception:
                            meta = nxt["intent"]
                    hits.append({"user_msg_id": m["id"], "fecha": m["created_at"],
                                 "ruta": (meta or {}).get("source") if isinstance(meta, dict) else None,
                                 "fuentes_meta": (meta or {}).get("sources") if isinstance(meta, dict) else None,
                                 "respuesta_guardada": nxt["text"] if nxt is not None else None})
            rutas[t["id"]] = hits
            last = hits[-1] if hits else None
            print(f"[{t['id']}] {len(hits)} envío(s); última ruta: {last['ruta'] if last else 'NO ENCONTRADA'}")
        json.dump(rutas, open(os.path.join(a.out, "rutas_imrc.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("Nota: la ruta de emergencia del v15 responde ANTES de guardar mensajes; una tarea sin")
        print("envíos registrados cuya intención es EMERGENCIA (p. ej. C3) tomó esa ruta.")

if __name__ == "__main__":
    main()

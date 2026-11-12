#!/usr/bin/env python3
"""
run_baseline.py — Genera las respuestas de la LÍNEA BASE (Sistema B):
Gemini 2.5 Flash SIN RAG (mismo generador que el chatbot, sin contexto documental).

Diseño controlado: se replica EXACTAMENTE la persona, el formato y los parámetros de
generación del chatbot-RAG; la ÚNICA diferencia es que aquí no hay bloque CONTEXTO ni
HISTORIAL. Así el contraste aísla el efecto del componente de recuperación (RAG).

Requisitos:
  pip install requests
  export GEMINI_API_KEY="<api-key>"

Uso:
  python3 run_baseline.py            # usa tasks.json en la misma carpeta
  python3 run_baseline.py --tasks tasks.json --out baseline_responses.json
"""
import os, json, time, argparse, datetime, sys

try:
    import requests
except ImportError:
    sys.exit("Falta 'requests'. Instala con: pip install requests")

MODEL = "gemini-2.5-flash"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

# Persona y formato IDÉNTICOS a los del chatbot-RAG, pero SIN instrucción de citar
# páginas (la cita por página es una capacidad propia del RAG; la base no tiene corpus).
SYSTEM_PROMPT = """
Eres un asistente técnico especializado en soldadura.
Tu alcance incluye: parámetros, defectos, consumibles, seguridad, equipo, materiales e inspección.

Reglas:
- No inventes normas, valores o procedimientos si no estás seguro.
- Si faltan datos, pide solo los mínimos necesarios.
- Prioriza seguridad industrial.
- Responde en español, claro y breve.
""".strip()

# generationConfig IGUAL al del chatbot-RAG (para no confundir el efecto del RAG con
# diferencias de muestreo): temperature 0.2, maxOutputTokens 1400, thinking apagado.
GEN_CONFIG = {
    "temperature": 0.2,
    "maxOutputTokens": 1400,
    "thinkingConfig": {"thinkingBudget": 0},
}

def ask_baseline(api_key, pregunta, max_retries=4):
    body = {
        "contents": [{
            "role": "user",
            "parts": [{"text": f"SYSTEM:\n{SYSTEM_PROMPT}\n\nCONSULTA:\n{pregunta}\n\nINSTRUCCIÓN:\nResponde con tu propio conocimiento, de forma honesta. Si no estás seguro, dilo."}],
        }],
        "generationConfig": GEN_CONFIG,
    }
    url = f"{ENDPOINT}?key={api_key}"
    wait = 1.0
    for attempt in range(max_retries + 1):
        try:
            r = requests.post(url, json=body, timeout=120)
            if r.status_code == 200:
                data = r.json()
                cand = (data.get("candidates") or [{}])[0]
                parts = (cand.get("content") or {}).get("parts") or [{}]
                return "".join(p.get("text", "") for p in parts).strip()
            if r.status_code in (429, 500, 503) and attempt < max_retries:
                time.sleep(wait); wait = min(wait * 2, 12); continue
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        except requests.RequestException as e:
            if attempt < max_retries:
                time.sleep(wait); wait = min(wait * 2, 12); continue
            raise RuntimeError(str(e))
    raise RuntimeError("Sin respuesta tras reintentos")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="tasks.json")
    ap.add_argument("--out", default="baseline_responses.json")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("Define GEMINI_API_KEY en el entorno.")

    tasks = json.load(open(args.tasks, encoding="utf-8"))["tareas"]
    out = {
        "meta": {
            "sistema": "B_base (Gemini 2.5 Flash sin RAG)",
            "model": MODEL,
            "generationConfig": GEN_CONFIG,
            "system_prompt": SYSTEM_PROMPT,
            "fecha": datetime.datetime.now().isoformat(timespec="seconds"),
        },
        "respuestas": {},
    }
    for t in tasks:
        print(f"[{t['id']}] consultando baseline…", flush=True)
        resp = ask_baseline(api_key, t["pregunta"])
        out["respuestas"][t["id"]] = resp
        time.sleep(1.0)  # cortesía con el rate limit

    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nListo. {len(out['respuestas'])} respuestas guardadas en {args.out}")

if __name__ == "__main__":
    main()

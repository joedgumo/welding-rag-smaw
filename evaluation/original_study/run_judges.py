#!/usr/bin/env python3
"""
run_judges.py — Evaluación automática con JUECES LLM (panel de 3 proveedores).

Toma el paquete anónimo (paquete_anon.json, generado por build_eval_packet.py) y, por cada
tarea, pide a cada juez que califique las respuestas Sistema A y Sistema B en las 5 métricas
(1–5) usando las anclas de la rúbrica y la respuesta de referencia. Escribe UNA hoja de
puntuación por juez, en el formato que lee analyze_scores.py.

Panel (uno por proveedor, independientes del sistema bajo prueba = Gemini 2.5 Flash):
  - OpenAI:    gpt-5.6-sol
  - Google:    gemini-3.1-pro-preview
  - Anthropic: claude-opus-5

Requisitos:
  pip install requests openpyxl
  set/env:  OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY
Uso:
  python3 run_judges.py                      # los 3 jueces
  python3 run_judges.py --judges opus5 gpt56 # solo algunos
"""
import os, sys, json, time, argparse, re
try:
    import requests
except ImportError:
    sys.exit("Falta 'requests'. Instala: pip install requests")
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

METRIC_KEYS = ["exactitud", "pertinencia", "confiabilidad", "fundamentacion", "control_alucinaciones"]
METRIC_COLS = ["Exactitud", "Pertinencia", "Confiabilidad", "Fundamentación", "Control alucinaciones"]

JUDGES = {
    "opus5":       {"provider": "anthropic", "model": "claude-opus-5",          "env": "ANTHROPIC_API_KEY"},
    "gpt56":       {"provider": "openai",    "model": "gpt-5.6-sol",            "env": "OPENAI_API_KEY"},
    "gemini31pro": {"provider": "google",    "model": "gemini-3.1-pro-preview", "env": "GEMINI_API_KEY"},
}

RUBRICA = """Eres un evaluador experto en soldadura. Calificas la calidad de respuestas técnicas
en 5 métricas, cada una en escala 1–5 (5 = mejor), de forma independiente:

1) Exactitud: corrección técnica frente a la respuesta de referencia. 5=totalmente correcta;
   3=parcial con un error relevante; 1=incorrecta o peligrosa.
2) Pertinencia: atiende directa y completamente la pregunta. 5=directa y completa;
   3=parcial u omite algo clave; 1=irrelevante.
3) Confiabilidad: atribución de fuente (documento y página) correcta y confianza calibrada.
   5=cita fuente/página correctas y declara incertidumbre cuando aplica; 3=cita genérica o
   exceso de seguridad; 1=cita inventada o atribución falsa.
4) Fundamentación: las afirmaciones son trazables a la fuente autorizada. 5=todas trazables;
   3=mezcla respaldadas/no respaldadas; 1=no se fundamenta o contradice la fuente.
5) Control de alucinaciones: ausencia de contenido fabricado. 5=nada inventado;
   3=una afirmación fabricada de bajo impacto; 1=fabricación grave (cifras/normas inventadas).

Reglas: califica cada respuesta por separado; no intentes deducir qué sistema la generó;
usa la respuesta de referencia y su fuente como verdad de referencia."""

def build_prompt(item):
    return f"""{RUBRICA}

PREGUNTA:
{item['pregunta']}

RESPUESTA DE REFERENCIA (verdad de referencia):
{item.get('referencia') or '(no proporcionada)'}
FUENTE DE REFERENCIA:
{item.get('fuente') or '(no proporcionada)'}

RESPUESTA DEL SISTEMA A:
{item['sistema_A']}

RESPUESTA DEL SISTEMA B:
{item['sistema_B']}

Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin texto adicional ni ```:
{{"A": {{"exactitud": <1-5>, "pertinencia": <1-5>, "confiabilidad": <1-5>, "fundamentacion": <1-5>, "control_alucinaciones": <1-5>, "comentario": "<breve>"}},
 "B": {{"exactitud": <1-5>, "pertinencia": <1-5>, "confiabilidad": <1-5>, "fundamentacion": <1-5>, "control_alucinaciones": <1-5>, "comentario": "<breve>"}}}}"""

# ---------- Llamadas por proveedor ----------
def _retry(fn, tries=4):
    wait = 1.0
    for i in range(tries + 1):
        try:
            return fn()
        except Exception as e:
            if i >= tries:
                raise
            time.sleep(wait); wait = min(wait * 2, 12)

def call_openai(model, prompt, api_key):
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {"model": model,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"}}
    # temperature 0 si el modelo lo acepta; algunos modelos de razonamiento lo rechazan.
    def go(extra):
        r = requests.post(url, headers=headers, json={**body, **extra}, timeout=180)
        if r.status_code >= 400:
            raise RuntimeError(f"OpenAI HTTP {r.status_code}: {r.text[:300]}")
        return r.json()["choices"][0]["message"]["content"]
    try:
        return _retry(lambda: go({"temperature": 0}))
    except Exception:
        return _retry(lambda: go({}))  # reintento sin temperature

def call_google(model, prompt, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}}
    def go():
        r = requests.post(url, json=body, timeout=180)
        if r.status_code >= 400:
            raise RuntimeError(f"Google HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts)
    return _retry(go)

def call_anthropic(model, prompt, api_key):
    url = "https://api.anthropic.com/v1/messages"
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    # Opus/Fable 5: thinking siempre activo; NO enviar 'thinking' ni 'temperature'. max_tokens amplio.
    body = {"model": model, "max_tokens": 6000,
            "messages": [{"role": "user", "content": prompt}]}
    def go():
        r = requests.post(url, headers=headers, json=body, timeout=240)
        if r.status_code >= 400:
            raise RuntimeError(f"Anthropic HTTP {r.status_code}: {r.text[:300]}")
        blocks = r.json().get("content", [])
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    return _retry(go)

CALLERS = {"openai": call_openai, "google": call_google, "anthropic": call_anthropic}

def parse_scores(raw):
    """Extrae el objeto JSON de la respuesta del juez (tolerante a ``` o texto extra)."""
    s = raw.strip()
    s = re.sub(r"^```(json)?|```$", "", s, flags=re.M).strip()
    m = re.search(r"\{.*\}", s, flags=re.S)
    if m:
        s = m.group(0)
    return json.loads(s)

def clamp(v):
    try:
        n = int(round(float(v)))
        return min(5, max(1, n))
    except Exception:
        return None

# ---------- Escritura de la hoja ----------
def write_sheet(judge_id, rows, out_xlsx):
    NAVY, ICE = "212958", "ECF3F8"
    wb = Workbook(); ws = wb.active; ws.title = "Puntuaciones"
    headers = ["Tarea", "Categoría", "Sistema", "Evaluador"] + METRIC_COLS + ["Comentario"]
    ws.append(headers)
    thin = Side(style="thin", color="CCCCCC"); bd = Border(left=thin, right=thin, top=thin, bottom=thin)
    hf = Font(bold=True, color="FFFFFF"); hfill = PatternFill("solid", fgColor=NAVY)
    for c in range(1, len(headers) + 1):
        cell = ws.cell(1, c); cell.font = hf; cell.fill = hfill; cell.border = bd
        cell.alignment = Alignment(horizontal="center")
    for row in rows:
        ws.append(row)
    for i, w in enumerate([9, 22, 8, 12, 11, 12, 13, 15, 16, 40], start=1):
        ws.column_dimensions[chr(64 + i)].width = w
    ws.freeze_panes = "A2"
    wb.save(out_xlsx)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--anon", default="paquete_anon.json")
    ap.add_argument("--judges", nargs="+", default=list(JUDGES.keys()),
                    help="ids: opus5 gpt56 gemini31pro")
    args = ap.parse_args()

    pack = json.load(open(args.anon, encoding="utf-8"))["tareas"]

    for jid in args.judges:
        spec = JUDGES[jid]
        api_key = os.environ.get(spec["env"])
        if not api_key:
            print(f"[{jid}] SALTADO: falta {spec['env']} en el entorno.")
            continue
        caller = CALLERS[spec["provider"]]
        rows = []
        print(f"\n=== Juez {jid} ({spec['model']}) ===")
        for item in pack:
            tnum = item["tarea"]
            try:
                raw = caller(spec["model"], build_prompt(item), api_key)
                sc = parse_scores(raw)
            except Exception as e:
                print(f"  Tarea {tnum}: ERROR {e}")
                sc = {"A": {}, "B": {}}
            for sistema in ("A", "B"):
                s = sc.get(sistema, {}) or {}
                metrics = [clamp(s.get(k)) for k in METRIC_KEYS]
                comentario = str(s.get("comentario", ""))[:500]
                rows.append([f"Tarea {tnum}", item["categoria"], sistema, jid, *metrics, comentario])
            print(f"  Tarea {tnum}: ok")
            time.sleep(0.5)
        out = f"E_{jid}.xlsx"
        write_sheet(jid, rows, out)
        print(f"  -> {out}")

    print("\nListo. Analiza con:")
    print("  python3 analyze_scores.py --key clave_desanonimizacion.csv --scores E_*.xlsx")

if __name__ == "__main__":
    main()

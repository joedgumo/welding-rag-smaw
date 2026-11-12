#!/usr/bin/env python3
"""
build_eval_packet.py — Arma el PAQUETE CIEGO para los evaluadores a partir de:
  - tasks.json               (las 12 tareas)
  - rag_responses.json       (respuestas del Sistema A_RAG, capturadas de Telegram)
  - baseline_responses.json  (respuestas del Sistema B_base, de run_baseline.py)

Produce:
  - Paquete_evaluadores.docx : una entrada por tarea con la pregunta y las dos respuestas
                               etiquetadas como "Sistema A" / "Sistema B" (SIN revelar cuál
                               es el RAG). El orden de las tareas se baraja.
  - clave_desanonimizacion.csv : mapa tarea -> qué etiqueta (A/B) es RAG y cuál es base.
                                 ESTE ARCHIVO NO SE ENTREGA A LOS EVALUADORES.

La asignación de A/B por tarea se aleatoriza pero se BALANCEA (≈6 y 6) y se fija con una
semilla reproducible (--seed). Se registra en la clave.

Requisitos: pip install python-docx
Uso:
  python3 build_eval_packet.py --seed 20260812

Nota: las respuestas del RAG se leen de rag_responses.txt (formato con marcadores
'=== ID ===', que tolera texto multilínea). El baseline se lee de baseline_responses.json.
"""
import json, csv, random, argparse, re
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

METRIC_COLS = ["Exactitud", "Pertinencia", "Confiabilidad", "Fundamentación", "Control alucinaciones"]

def build_reference_sheet(order, tasks_by_id, refs, ref_meta, out_docx):
    """Hoja de referencia (ground truth + fuente) en el MISMO orden del paquete.
    Es blind-safe: muestra la respuesta de referencia y la fuente por tarea, sin revelar
    qué sistema (A/B) generó cada respuesta."""
    NAVY = RGBColor(0x21, 0x29, 0x58); TEAL = RGBColor(0x1C, 0x72, 0x93)
    AMBER = RGBColor(0xF2, 0xA4, 0x44)
    doc = Document()
    doc.styles["Normal"].font.name = "Arial"; doc.styles["Normal"].font.size = Pt(11)
    h = doc.add_paragraph(); r = h.add_run("Respuestas de referencia y fuentes — apoyo para el evaluador")
    r.bold = True; r.font.size = Pt(15); r.font.color.rgb = NAVY
    intro = doc.add_paragraph("Use esta hoja para juzgar la exactitud (contra la respuesta de referencia) y la fundamentación (contra la fuente) de cada respuesta. No indica qué sistema generó cada respuesta.")
    intro.runs[0].font.size = Pt(10)
    estado = str(ref_meta.get("estado", ""))
    if "BORRADOR" in estado.upper() or "pendiente" in estado.lower():
        w = doc.add_paragraph().add_run("AVISO: respuestas de referencia en BORRADOR, pendientes de validación de la experta. No repartir hasta validarlas.")
        w.bold = True; w.font.color.rgb = AMBER; w.font.size = Pt(10)
    for display_i, tid in enumerate(order, 1):
        t = tasks_by_id[tid]; ref = refs.get(tid, {})
        p = doc.add_paragraph(); rr = p.add_run(f"Tarea {display_i}  ·  [{t['categoria']}]")
        rr.bold = True; rr.font.color.rgb = TEAL; rr.font.size = Pt(12)
        pq = doc.add_paragraph(); pq.add_run("Pregunta: ").bold = True; pq.add_run(t["pregunta"])
        pa = doc.add_paragraph(); pa.add_run("Respuesta de referencia: ").bold = True
        pa.add_run(ref.get("respuesta", "(pendiente)"))
        pf = doc.add_paragraph(); pf.add_run("Fuente: ").bold = True
        pf.add_run(ref.get("fuente", "(pendiente)"))
        doc.add_paragraph("—" * 20)
    doc.save(out_docx)


def build_scoring_sheet(order, tasks_by_id, out_xlsx):
    """Hoja de puntuación CIEGA, en el MISMO orden barajado que el paquete.
    Sin etiquetas RAG/base; el análisis se hace aparte con la clave."""
    NAVY, ICE = "212958", "ECF3F8"
    wb = Workbook()
    thin = Side(style="thin", color="CCCCCC")
    bd = Border(left=thin, right=thin, top=thin, bottom=thin)
    hf = Font(name="Arial", bold=True, color="FFFFFF", size=11)
    hfill = PatternFill("solid", fgColor=NAVY)
    base = Font(name="Arial", size=11)
    ctr = Alignment(horizontal="center", vertical="center")
    lft = Alignment(horizontal="left", vertical="center", wrap_text=True)

    ins = wb.active; ins.title = "Instrucciones"
    ins["A1"] = "Hoja de puntuación — respuestas técnicas de soldadura"
    ins["A1"].font = Font(name="Arial", bold=True, size=14, color=NAVY)
    for i, t in enumerate([
        "",
        "1. Califique las 5 métricas (1 a 5; 5 = mejor) de cada respuesta, en la hoja 'Puntuaciones'.",
        "2. Cada tarea tiene dos respuestas anónimas: Sistema A y Sistema B. Evalúe cada una por separado.",
        "3. Escriba su identificador en la columna 'Evaluador' (p. ej. E1). Si hay varios evaluadores, cada uno usa su propia copia de esta hoja.",
        "4. Apóyese en la respuesta de referencia y los pasajes fuente para juzgar exactitud y fundamentación.",
        "5. Use 'Comentario' para justificar puntuaciones bajas.",
        "",
        "Definiciones y anclas 1–5 de cada métrica: ver la rúbrica (DOCX).",
    ], start=2):
        ins[f"A{i}"] = t; ins[f"A{i}"].font = base; ins[f"A{i}"].alignment = lft
    ins.column_dimensions["A"].width = 115

    ws = wb.create_sheet("Puntuaciones")
    headers = ["Tarea", "Categoría", "Sistema", "Evaluador"] + METRIC_COLS + ["Comentario"]
    ws.append(headers)
    for c in range(1, len(headers) + 1):
        cell = ws.cell(1, c); cell.font = hf; cell.fill = hfill; cell.alignment = ctr; cell.border = bd

    r = 2
    for display_i, tid in enumerate(order, 1):
        cat = tasks_by_id[tid]["categoria"]
        for sistema in ("A", "B"):
            ws.cell(r, 1, f"Tarea {display_i}")
            ws.cell(r, 2, cat)
            ws.cell(r, 3, sistema)
            ws.cell(r, 4, "E1")
            for c in range(1, len(headers) + 1):
                cell = ws.cell(r, c); cell.border = bd; cell.font = base
                cell.alignment = lft if c == len(headers) else ctr
                if sistema == "A":
                    cell.fill = PatternFill("solid", fgColor=ICE)
            r += 1

    dv = DataValidation(type="whole", operator="between", formula1=1, formula2=5, allow_blank=True,
                        showErrorMessage=True, errorTitle="Valor inválido", error="Escriba un entero de 1 a 5.")
    ws.add_data_validation(dv); dv.add("E2:I200")
    for i, w in enumerate([9, 22, 8, 10, 11, 12, 13, 15, 16, 40], start=1):
        ws.column_dimensions[chr(64 + i)].width = w
    ws.freeze_panes = "A2"
    wb.save(out_xlsx)

NAVY = RGBColor(0x21, 0x29, 0x58)
TEAL = RGBColor(0x1C, 0x72, 0x93)

def load(p): return json.load(open(p, encoding="utf-8"))

def load_rag_txt(path):
    """Lee rag_responses.txt con bloques '=== ID ===' y devuelve {id: texto}."""
    raw = open(path, encoding="utf-8").read()
    out, current, buf = {}, None, []
    for line in raw.splitlines():
        m = re.match(r"^===\s*([A-Za-z0-9]+)\s*===\s*$", line)
        if m:
            if current is not None:
                out[current] = "\n".join(buf).strip()
            current, buf = m.group(1).upper(), []
        elif current is not None and not line.strip().startswith("#"):
            buf.append(line)
    if current is not None:
        out[current] = "\n".join(buf).strip()
    # Avisar si quedó algún placeholder sin reemplazar
    faltan = [k for k, v in out.items() if (not v) or "PEGA_AQUI" in v]
    if faltan:
        print(f"AVISO: faltan respuestas del RAG para: {', '.join(sorted(faltan))}")
    return out

def balanced_assignment(task_ids, seed):
    """Devuelve dict tarea_id -> 'A' o 'B' indicando qué etiqueta será el RAG,
    balanceado (mitad A, mitad B) y barajado de forma reproducible."""
    rnd = random.Random(seed)
    n = len(task_ids)
    labels = ["A"] * (n // 2) + ["B"] * (n - n // 2)
    rnd.shuffle(labels)
    return {tid: lab for tid, lab in zip(task_ids, labels)}, rnd

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="tasks.json")
    ap.add_argument("--rag", default="rag_responses.txt")
    ap.add_argument("--baseline", default="baseline_responses.json")
    ap.add_argument("--seed", type=int, default=20260812)
    ap.add_argument("--out_docx", default="Paquete_evaluadores.docx")
    ap.add_argument("--out_key", default="clave_desanonimizacion.csv")
    ap.add_argument("--out_xlsx", default="Hoja_puntuacion_CIEGA.xlsx")
    ap.add_argument("--refs", default="referencias.json")
    ap.add_argument("--out_ref", default="Hoja_referencia_evaluadores.docx")
    ap.add_argument("--out_anon", default="paquete_anon.json")
    args = ap.parse_args()

    tasks = load(args.tasks)["tareas"]
    rag = load_rag_txt(args.rag)
    base = load(args.baseline)["respuestas"]

    task_ids = [t["id"] for t in tasks]
    rag_label, rnd = balanced_assignment(task_ids, args.seed)

    # Orden de presentación barajado
    order = task_ids[:]
    rnd.shuffle(order)
    tasks_by_id = {t["id"]: t for t in tasks}

    # Cargar referencias (para incluirlas en el paquete legible por máquina)
    try:
        refs_all = load(args.refs).get("referencias", {})
    except FileNotFoundError:
        refs_all = {}

    # Estructura anónima compartida (para DOCX, JSON y jueces LLM). Blind-safe:
    # no revela cuál de A/B es el RAG.
    anon = []
    for display_i, tid in enumerate(order, 1):
        t = tasks_by_id[tid]
        if rag_label[tid] == "A":
            a_text, b_text = rag.get(tid, ""), base.get(tid, "")
        else:
            a_text, b_text = base.get(tid, ""), rag.get(tid, "")
        ref = refs_all.get(tid, {})
        anon.append({
            "tarea": display_i, "categoria": t["categoria"], "pregunta": t["pregunta"],
            "sistema_A": a_text, "sistema_B": b_text,
            "referencia": ref.get("respuesta", ""), "fuente": ref.get("fuente", ""),
        })

    # --- DOCX ciego ---
    doc = Document()
    doc.styles["Normal"].font.name = "Arial"
    doc.styles["Normal"].font.size = Pt(11)

    h = doc.add_paragraph()
    r = h.add_run("Paquete de evaluación ciega — Asistente de soldadura")
    r.bold = True; r.font.size = Pt(15); r.font.color.rgb = NAVY

    intro = doc.add_paragraph(
        "Para cada tarea encontrará la pregunta y dos respuestas anónimas (Sistema A y "
        "Sistema B). Califique cada respuesta con las 5 métricas (1–5) en la hoja de "
        "puntuación, sin intentar deducir qué sistema la generó. Dispone de la respuesta "
        "de referencia validada y de los pasajes fuente para juzgar exactitud y fundamentación."
    )
    intro.runs[0].font.size = Pt(10)

    for entry in anon:
        display_i = entry["tarea"]
        a_text, b_text = entry["sistema_A"], entry["sistema_B"]

        p = doc.add_paragraph()
        rr = p.add_run(f"Tarea {display_i}  ·  [{entry['categoria']}]")
        rr.bold = True; rr.font.color.rgb = TEAL; rr.font.size = Pt(12)

        pq = doc.add_paragraph()
        pq.add_run("Pregunta: ").bold = True
        pq.add_run(entry["pregunta"])

        for lab, txt in (("Sistema A", a_text), ("Sistema B", b_text)):
            pa = doc.add_paragraph()
            pa.add_run(f"{lab}:").bold = True
            doc.add_paragraph(txt if txt else "(respuesta pendiente)")
        doc.add_paragraph("—" * 20)

    doc.save(args.out_docx)

    # --- Clave (NO se entrega a evaluadores) ---
    with open(args.out_key, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["orden_presentacion", "tarea_id", "categoria",
                    "Sistema_A_es", "Sistema_B_es"])
        for display_i, tid in enumerate(order, 1):
            if rag_label[tid] == "A":
                a_is, b_is = "RAG", "baseline"
            else:
                a_is, b_is = "baseline", "RAG"
            w.writerow([display_i, tid, tasks_by_id[tid]["categoria"], a_is, b_is])

    # --- Hoja de puntuación CIEGA (mismo orden que el paquete) ---
    build_scoring_sheet(order, tasks_by_id, args.out_xlsx)

    # --- Paquete anónimo legible por máquina (para run_judges.py) ---
    with open(args.out_anon, "w", encoding="utf-8") as f:
        json.dump({"seed": args.seed, "tareas": anon}, f, ensure_ascii=False, indent=2)

    # --- Hoja de referencia (ground truth + fuente, mismo orden) ---
    ref_msg = ""
    try:
        refdoc = load(args.refs)
        build_reference_sheet(order, tasks_by_id, refdoc.get("referencias", {}),
                              refdoc.get("meta", {}), args.out_ref)
        ref_msg = f"Hoja referencia  -> {args.out_ref}  (para los evaluadores)"
    except FileNotFoundError:
        ref_msg = f"(AVISO: no encontré {args.refs}; no se generó la hoja de referencia)"

    print(f"Semilla: {args.seed}")
    print(f"Paquete ciego     -> {args.out_docx}")
    print(f"Hoja puntuación   -> {args.out_xlsx}  (para los evaluadores)")
    if ref_msg: print(ref_msg)
    print(f"Clave (privada)   -> {args.out_key}  (NO entregar a los evaluadores)")

if __name__ == "__main__":
    main()

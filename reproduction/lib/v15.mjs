// Réplica FIEL de la recuperación y del prompt del chatbot v15 (src/index.js), usando sus
// propias funciones exportadas en __test__. Lo que no está exportado (getTopChunksSemantic,
// callGeminiAnswer, truncateText) se copia aquí línea por línea, sin cambios de lógica.
// Referencias: assistant/src/index.js líneas 1687-1735 (recuperación), 1449-1520 (prompt), 540 (truncado).

import { __test__ as T } from "../../assistant/src/index.js";

export const classifyIntent = T.classifyIntent;

export function truncateText(text = "", maxLen = 12000) {
  const s = String(text || "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n\n[contexto truncado]";
}

// rows: chunks del chat en el MISMO orden que la consulta SQL del v15
// (ORDER BY id DESC LIMIT 600). queryEmbedding: embedding de la pregunta.
export function scoreChunks(query, queryEmbedding, rows, limit = 10) {
  const window = [...rows].sort((a, b) => b.id - a.id).slice(0, 600);
  return window
    .map((r) => {
      let semanticScore = 0;
      try {
        const emb = Array.isArray(r.embedding) ? r.embedding : JSON.parse(r.embedding || "null");
        semanticScore = T.cosineSimilarity(queryEmbedding, emb);
      } catch { semanticScore = 0; }
      const kw = T.keywordScoreDetailed(query, r.content);
      const phr = T.phraseScore(query, r.content);
      const sec = T.sectionMatchScore(query, r.content);
      const imp = T.importantTermBoost(query, r.content);
      const finalScore = semanticScore * 10 + kw.score * 1.8 + phr * 1.5 + sec * 2.5 + imp;
      return {
        id: r.id, document_id: r.document_id, source_name: r.source_name,
        chunk_index: r.chunk_index, page: r.page, content: r.content,
        semanticScore, keywordScore: kw.score, keywordCoverage: kw.coverage,
        phraseScore: phr, sectionScore: sec, importantBoost: imp, score: finalScore,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function windowInfo(rows) {
  return { total_chunks: rows.length, searched: Math.min(rows.length, 600), limit_600_binding: rows.length > 600 };
}

function pageTag(p) {
  return Number.isFinite(Number(p)) && Number(p) > 0 ? Number(p) : "?";
}

export function ragBlocks(topChunks) {
  return topChunks.map((c) =>
    `[DOC:${c.source_name} | pág:${pageTag(c.page)} | doc_id:${c.document_id} | score:${c.score.toFixed(2)} | sem:${c.semanticScore.toFixed(3)} | kw:${c.keywordScore.toFixed(2)} | sec:${c.sectionScore.toFixed(2)} | phr:${c.phraseScore.toFixed(2)}] ${c.content}`
  );
}

export function buildRagContext(topChunks) {
  return truncateText(ragBlocks(topChunks).join("\n\n"), 14000);
}

// Cuántos de los pasajes recuperados llegan COMPLETOS al modelo tras el truncado a 14,000.
export function passagesInContext(topChunks) {
  let end = 0, n = 0;
  for (const b of ragBlocks(topChunks)) { end += (n ? 2 : 0) + b.length; if (end <= 14000) n++; else break; }
  return n;
}

// Brazo LC: el corpus completo, una entrada por página, con la misma etiqueta DOC/pág
// para que el modelo pueda citar igual que en RAG. Sin puntajes (no hay recuperación).
export function buildLongContext(pages) {
  return pages.map((p) => `[DOC:${p.source_name} | pág:${pageTag(p.page)}] ${p.text}`).join("\n\n");
}

// Prompt IDÉNTICO al de callGeminiAnswer del v15.
export function buildV15Prompt({ userText, intent, contextText, conversationText = "" }) {
  const systemPrompt = `
Eres un asistente técnico especializado en soldadura.
Tu alcance incluye: parámetros, defectos, consumibles, seguridad, equipo, materiales e inspección.

Reglas:
- Usa primero el CONTEXTO si es relevante.
- Si el contexto no contiene la respuesta, dilo claramente.
- No inventes normas, valores o procedimientos si no estás seguro.
- Si faltan datos, pide solo los mínimos necesarios.
- Prioriza seguridad industrial.
- Responde en español, claro y breve.
- Si la CONSULTA es una pregunta de seguimiento (p. ej. "¿con un qué?", "¿y luego?"),
  interprétala usando el HISTORIAL de la conversación para mantener el hilo.
- Si usas información del contexto, al final agrega una línea de fuentes citando el
  documento y la PÁGINA (campo "pág:" de cada bloque del CONTEXTO), con este formato:
  Fuentes: nombre_documento (pág. N), nombre_documento (pág. M)
  No cites números de chunk. Si un bloque no trae página (pág:?), cita solo el documento.

Intención detectada: ${intent}
`.trim();

  return `
SYSTEM:
${systemPrompt}

HISTORIAL RECIENTE:
${conversationText || "(sin historial previo)"}

CONTEXTO:
${contextText || "(sin contexto documental relevante)"}

CONSULTA:
${userText}

INSTRUCCIÓN:
Responde usando el contexto cuando aplique. Si el contexto no basta, dilo con honestidad.
`.trim();
}

// Prompt del baseline sin recuperación, IDÉNTICO a run_baseline.py del paquete IMRC.
export function buildBaselinePrompt(question) {
  const SYSTEM_PROMPT = `
Eres un asistente técnico especializado en soldadura.
Tu alcance incluye: parámetros, defectos, consumibles, seguridad, equipo, materiales e inspección.

Reglas:
- No inventes normas, valores o procedimientos si no estás seguro.
- Si faltan datos, pide solo los mínimos necesarios.
- Prioriza seguridad industrial.
- Responde en español, claro y breve.
`.trim();
  return `SYSTEM:\n${SYSTEM_PROMPT}\n\nCONSULTA:\n${question}\n\nINSTRUCCIÓN:\nResponde con tu propio conocimiento, de forma honesta. Si no estás seguro, dilo.`;
}

// Páginas citadas en una respuesta ("Fuentes: X.pdf (pág. 76), X.pdf (pág. 83, 70)").
export function citedPages(answer = "") {
  const out = [];
  const line = String(answer).split("\n").reverse().find((l) => /^\s*Fuentes?:/i.test(l)) || "";
  // Acepta "X.pdf (pág. 7)" y también "X (pág. 7)" sin extensión; normaliza a X.pdf.
  const re = /(AWS_[\w.\-]+?)(?:\.pdf)?\s*\(p[áa]g[s]?\.?\s*([\d,\s\-–]+)\)/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    const src = `${m[1]}.pdf`;
    for (const part of m[2].split(/,\s*/).map((x) => x.trim()).filter(Boolean)) {
      const r = part.match(/^(\d+)\s*[\-–]\s*(\d+)$/);
      if (r) { for (let n = Number(r[1]); n <= Number(r[2]); n++) out.push({ source: src, page: n }); }
      else for (const n of part.split(/\s+/).filter(Boolean)) if (/^\d+$/.test(n)) out.push({ source: src, page: Number(n) });
    }
  }
  return out;
}

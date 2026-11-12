function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeText(text = "") {
  return String(text || "").toLowerCase().trim();
}

function tokenize(text = "") {
  return normalizeText(text)
    .split(/[^a-z0-9áéíóúñü.]+/i)
    .filter((t) => t.length > 1);
}

function unique(arr = []) {
  return [...new Set(arr)];
}

function escapeRegExp(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSectionRefs(text = "") {
  const matches = String(text || "").match(/\b(?:[A-Z]\d+(?:\.\d+)*|\d+(?:\.\d+)+)\b/g);
  return unique((matches || []).map((m) => m.trim()));
}

function phraseScore(query, content) {
  const q = normalizeText(query);
  const c = normalizeText(content);
  if (!q || !c) return 0;

  let score = 0;
  if (c.includes(q)) score += 6;

  const phrases = q
    .split(/[?,;:!]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);

  for (const p of phrases) {
    if (c.includes(p)) score += 3;
  }

  return score;
}

function keywordScoreDetailed(query, content) {
  const qTokens = tokenize(query).filter((t) => t.length > 2);
  const c = normalizeText(content);

  let matched = 0;
  let exact = 0;

  for (const token of qTokens) {
    if (c.includes(token)) {
      matched += 1;
      exact += token.length >= 6 ? 1.5 : 1;
    }
  }

  const coverage = qTokens.length ? matched / qTokens.length : 0;

  return {
    matched,
    coverage,
    score: exact + coverage * 2,
  };
}

function sectionMatchScore(query, content) {
  const refs = extractSectionRefs(query);
  if (!refs.length) return 0;

  const c = String(content || "");
  let score = 0;

  for (const ref of refs) {
    const rx = new RegExp(`\\b${escapeRegExp(ref)}\\b`, "i");
    if (rx.test(c)) score += 8;
  }

  return score;
}

function importantTermBoost(query, content) {
  const qTokens = unique(tokenize(query).filter((t) => t.length >= 4));
  const c = normalizeText(content);
  let score = 0;

  for (const token of qTokens) {
    if (c.includes(token)) {
      if (token.length >= 9) score += 1.5;
      else if (token.length >= 6) score += 1;
      else score += 0.5;
    }
  }

  return score;
}

function classifyIntent(text) {
  const t = normalizeText(text);

  const emergencyPatterns = [
    /incendio/,
    /explosi[oó]n/,
    /fuga de gas/,
    /descarga el[eé]ctrica/,
    /quemadura grave/,
    /humo t[oó]xico/,
    /intoxicaci[oó]n/,
    /accidente/,
  ];

  for (const p of emergencyPatterns) {
    if (p.test(t)) return { intent: "EMERGENCIA", confidence: 0.95 };
  }

  if (/(porosidad|grieta|socavado|falta de fusi[oó]n|salpicadura|defecto)/.test(t)) return { intent: "DEFECTOS", confidence: 0.8 };
  if (/(amperaje|voltaje|velocidad|par[aá]metros|wfs|wire feed|gas flow)/.test(t)) return { intent: "PARAMETROS", confidence: 0.8 };
  if (/(electrodo|alambre|fundente|varilla|consumible)/.test(t)) return { intent: "CONSUMIBLES", confidence: 0.8 };
  if (/(seguridad|epp|careta|guantes|ventilaci[oó]n|riesgo)/.test(t)) return { intent: "SEGURIDAD", confidence: 0.8 };
  if (/(maquina|máquina|equipo|soldadora|antorcha|boquilla|rodillo)/.test(t)) return { intent: "EQUIPO", confidence: 0.8 };
  if (/(acero|inoxidable|aluminio|material|metal base)/.test(t)) return { intent: "MATERIALES", confidence: 0.8 };
  if (/(inspecci[oó]n|vt|pt|ut|rt|ensayo|calidad)/.test(t)) return { intent: "INSPECCION", confidence: 0.8 };
  if (/(hola|buenas|hey)/.test(t)) return { intent: "SOCIAL", confidence: 0.7 };

  return { intent: "OTRO", confidence: 0.4 };
}

function emergencyResponse() {
  return [
    "⚠️ Posible emergencia industrial detectada.",
    "",
    "1. Detén la operación si es seguro hacerlo.",
    "2. Corta energía o suministro de gas si aplica y si estás capacitado.",
    "3. Evacúa la zona si hay riesgo inmediato.",
    "4. Activa el protocolo interno de seguridad y contacta al responsable HSE/supervisor.",
    "5. Si hay lesionados o peligro grave, llama a emergencias locales de inmediato.",
    "",
    "No continúes soldando hasta controlar la situación.",
  ].join("\n");
}

function baseResponse(intent) {
  switch (intent) {
    case "SOCIAL":
      return "Hola 👋 Soy un asistente técnico de soldadura.";
    case "PARAMETROS":
      return "Indícame proceso, material, espesor, posición y consumible.";
    case "DEFECTOS":
      return "Describe el defecto observado, proceso, material y condiciones.";
    case "CONSUMIBLES":
      return "Dime proceso, material base, posición y requisito mecánico o normativo.";
    case "SEGURIDAD":
      return "Indícame el riesgo o la actividad para darte recomendaciones técnicas.";
    case "EQUIPO":
      return "Dime modelo, proceso y falla observada.";
    case "MATERIALES":
      return "Indícame metal base, espesor y proceso.";
    case "INSPECCION":
      return "Dime el criterio, ensayo o discontinuidad que quieres revisar.";
    default:
      return "Cuéntame tu duda de soldadura con detalle: proceso, material, espesor, posición, consumible, gas y problema observado.";
  }
}

function splitIntoChunks(text, chunkSize = 1200, overlap = 150) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const chunks = [];
  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + chunkSize);
    const chunk = cleaned.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function splitIntoPageChunks(rawText, chunkSize = 1200, overlap = 150) {
  // Trocea el texto en chunks asignando a cada uno su número de página, usando los
  // marcadores "==Start/End of OCR for page N==" que inserta la extracción de Gemini.
  // Devuelve [{ content, page }]. Si no hay marcadores, page = null.
  const text = String(rawText || "");
  const startRe = /==\s*Start of OCR for page\s+(\d+)\s*==/gi;
  const endRe = /==\s*End of OCR for page\s+\d+\s*==/gi;

  const startMatches = [];
  let m;
  while ((m = startRe.exec(text)) !== null) {
    startMatches.push({ index: m.index, end: m.index + m[0].length, page: Number(m[1]) });
  }

  if (!startMatches.length) {
    // Sin marcadores de página: troceo normal, sin página.
    return splitIntoChunks(text, chunkSize, overlap).map((content) => ({ content, page: null }));
  }

  // Segmentar el texto por páginas.
  const segments = [];
  const pre = text.slice(0, startMatches[0].index);
  if (pre.trim()) segments.push({ page: startMatches[0].page, text: pre });
  for (let i = 0; i < startMatches.length; i++) {
    const segStart = startMatches[i].end;
    const segEnd = i + 1 < startMatches.length ? startMatches[i + 1].index : text.length;
    segments.push({ page: startMatches[i].page, text: text.slice(segStart, segEnd) });
  }

  // Construir texto limpio (sin marcadores) y registrar el offset donde inicia cada página.
  let clean = "";
  const boundaries = []; // [{ offset, page }]
  for (const seg of segments) {
    const segClean = cleanExtractedText(seg.text.replace(endRe, " ")).replace(/\s+/g, " ").trim();
    if (!segClean) continue;
    if (clean) clean += " ";
    boundaries.push({ offset: clean.length, page: seg.page });
    clean += segClean;
  }

  // Trocear (mismo esquema char-based + overlap) y asignar la página del inicio del chunk.
  const result = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + chunkSize);
    const content = clean.slice(start, end).trim();
    if (content) {
      // página = la que cubre la mayor parte del chunk [start, end)
      let page = boundaries[0]?.page ?? null;
      let bestOverlap = -1;
      for (let bi = 0; bi < boundaries.length; bi++) {
        const segStart = boundaries[bi].offset;
        const segEnd = bi + 1 < boundaries.length ? boundaries[bi + 1].offset : clean.length;
        const overlap = Math.min(end, segEnd) - Math.max(start, segStart);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          page = boundaries[bi].page;
        }
      }
      result.push({ content, page });
    }
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return result;
}

function cleanExtractedText(text = "") {
  const lines = String(text || "")
    .replace(/\r/g, "")
    // Cosmético: quitar marcadores de OCR por página que inserta la extracción.
    .replace(/==\s*(?:Start|End) of OCR for page\s+\d+\s*==/gi, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^[.\s•·\-–—_]{10,}$/.test(line)) return false;
      if (/^(?:\.\s*){8,}$/.test(line)) return false;
      if (/^(?:[_\-–—]\s*){8,}$/.test(line)) return false;
      if (/^(?:\d+\s*\.\s*){6,}$/.test(line)) return false;
      return true;
    });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isUsefulChunk(text = "") {
  const s = String(text || "").trim();
  if (!s) return false;

  const letters = (s.match(/[a-záéíóúñü]/gi) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  const words = s.split(/\s+/).filter(Boolean).length;

  if (letters < 40 && digits < 10) return false;
  if (words < 8) return false;
  if (dots > Math.max(letters * 1.2, 80)) return false;
  if (/^[.\s•·\-–—_0-9]+$/.test(s)) return false;

  return true;
}

function sanitizeTelegramText(text = "") {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/¨ª/g, "í")
    .replace(/¨®/g, "ó")
    .replace(/¨¦/g, "é")
    .replace(/¨¢/g, "á")
    .replace(/¨¹/g, "ú")
    .replace(/車/g, "ó")
    .replace(/谷/g, "é")
    .replace(/赤/g, "í")
    .replace(/芍/g, "á")
    .replace(/迆/g, "ú")
    .replace(/Recib¨ª/g, "Recibí")
    .replace(/pondr¨¦/g, "pondré")
    .replace(/extracci¨®n/g, "extracción")
    .replace(/ventilaci¨®n/g, "ventilación")
    .replace(/ox¨ªgeno/g, "oxígeno")
    .replace(/Cu¨¦ntame/g, "Cuéntame")
    .replace(/est¨¢ndar/g, "estándar")
    .replace(/informaci¨®n/g, "información")
    .replace(/espec¨ªficos/g, "específicos")
    .replace(/Ind¨ªcame/g, "Indícame")
    .replace(/t¨¦cnicas/g, "técnicas")
    .replace(/m¨¢s/g, "más")
    .replace(/reintentar¨¢/g, "reintentará")
    .replace(/fall¨®/g, "falló")
    .replace(/\?\?/g, "📄")
    .replace(/\s{3,}/g, "  ")
    .trim();
}


function splitTelegramText(text = "", maxLen = 3800) {
  const s = sanitizeTelegramText(text || "");
  if (!s) return [""];
  if (s.length <= maxLen) return [s];

  const parts = [];
  let remaining = s;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut < Math.floor(maxLen * 0.6)) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.6)) cut = remaining.lastIndexOf(". ", maxLen);
    if (cut < Math.floor(maxLen * 0.6)) cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < Math.floor(maxLen * 0.5)) cut = maxLen;

    const part = remaining.slice(0, cut).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) parts.push(remaining);
  return parts.length ? parts : [s.slice(0, maxLen)];
}

async function sendTelegramLongMessage(env, chatId, text, maxLen = 3800) {
  const parts = splitTelegramText(text, maxLen);
  for (let i = 0; i < parts.length; i++) {
    await sendTelegramMessage(env, chatId, parts[i]);
  }
}

function isWeakAnswerText(text = "") {
  const a = normalizeText(text);
  if (!a) return true;

  const weakPatterns = [
    "el contexto no contiene",
    "no enumera",
    "no detalla",
    "no proporciona",
    "no contiene información",
    "no contiene la respuesta",
    "sería necesario consultar la norma completa",
    "seria necesario consultar la norma completa",
    "no encontré información",
    "no encontre información",
    "no encontre informacion",
    "no pude determinar",
    "no puedo determinar",
    "dime el criterio",
    "cuéntame tu duda",
    "cuentame tu duda",
    "indícame",
    "indicame",
    "no pude consultar gemini",
    "evidencia suficiente"
  ];

  if (weakPatterns.some((p) => a.includes(p))) return true;
  if (a.length < 45) return true;
  return false;
}

function isFollowUpQuestion(text = "") {
  const t = normalizeText(text).replace(/[¿?¡!]/g, "").trim();
  const wordCount = t.split(/\s+/).filter(Boolean).length;

  // Aclaraciones muy cortas que sólo tienen sentido respecto al turno anterior:
  // "con un que", "y luego", "de que", "como cual", "por que", "y eso", etc.
  if (wordCount <= 4 && /^(con\s+un\s+qu[eé]|con\s+qu[eé]|de\s+qu[eé]|y\s+luego|y\s+despu[eé]s|y\s+eso|como\s+cu[aá]l|cu[aá]l|por\s+qu[eé]|y\s+qu[eé]|qu[eé]\s+mas|qu[eé]\s+m[aá]s|continua|sigue|amplia|expl[ií]cate)(?=\s|$)/.test(t)) {
    return true;
  }

  return (
    /^(y\s+en|y\s+sobre|y\s+respecto|y\s+en\s+lo\s+que\s+se\s+refiere|sobre\s+eso|respecto\s+a|en\s+lo\s+referente\s+a|en\s+lo\s+que\s+se\s+refiere\s+a|sobre\s+lo\s+anterior|y\b)/.test(t) ||
    /^(eso|aquello|ese\s+tema|ese\s+apartado)\b/.test(t)
  );
}

function hasExplicitSectionReference(text = "") {
  return /\b(?:[A-Z]\d+(?:\.\d+){0,5}|\d+(?:\.\d+){1,6})\b/.test(String(text || ""));
}

function isShortThematicQuestion(text = "") {
  const t = normalizeText(text).replace(/[¿?¡!.,;:()]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  const words = t.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;

  const thematicTerms = [
    "espacios confinados", "ventilacion", "ventilación", "oxigeno", "oxígeno",
    "cilindros", "soldadura blanda", "soldadura fuerte", "supresores",
    "retroceso de llama", "fundentes", "contratistas", "quemaduras",
    "gases", "humos", "epp", "riesgos", "peligros", "seguridad"
  ];
  return thematicTerms.some((term) => t.includes(normalizeText(term)));
}

function isExplicitDocumentQuestion(text = "") {
  const t = normalizeText(text);
  if (hasExplicitSectionReference(text)) return true;

  const patterns = [
    /qué dice/, /que dice/, /de qué trata/, /de que trata/, /de qué se trata/, /de que se trata/,
    /de qué habla/, /de que habla/, /explica/, /explícame/, /explicame/,
    /según/, /segun/, /apartado/, /sección/, /seccion/, /cláusula/, /clausula/,
    /anexo/, /inciso/, /numeral/, /norma/, /aws/, /artículo/, /articulo/,
    /enumera/, /requisitos/, /peligros/, /cómo/, /como/, /uso/, /usarse/, /deben usarse/
  ];
  return patterns.some((p) => p.test(t));
}

function expandFollowUpQuestion(currentText = "", previousUserText = "") {
  const current = String(currentText || "").trim();
  const previous = String(previousUserText || "").trim();
  if (!current) return "";
  if (!previous) return current;
  if (!isFollowUpQuestion(current)) return current;

  const cleanedCurrent = current
    .replace(/^(y\s+en|y\s+sobre|y\s+respecto|y\s+en\s+lo\s+que\s+se\s+refiere\s+a|sobre\s+eso|respecto\s+a|en\s+lo\s+referente\s+a|en\s+lo\s+que\s+se\s+refiere\s+a)\s*/i, "")
    .trim();

  if (!cleanedCurrent) return previous;
  return `${previous}. Ampliación o seguimiento: ${cleanedCurrent}`;
}

function computeRetrievalStrength(topChunks = []) {
  const top = topChunks[0] || {};
  const topScore = Number(top.score || 0);
  const topSemantic = Number(top.semanticScore || 0);
  const coverage = Number(top.keywordCoverage || 0);
  const docs = new Set(topChunks.map((c) => c.document_id).filter(Boolean)).size;

  return {
    topScore,
    topSemantic,
    coverage,
    docCount: docs,
    weak:
      !topChunks.length ||
      topScore < 6.5 ||
      topSemantic < 0.18 ||
      (coverage < 0.2 && topScore < 8.5)
  };
}


function shouldFallbackToDirectDoc(userText = "", answerText = "", topChunks = [], hasCompletedDocs = false) {
  if (!hasCompletedDocs) return false;

  const q = normalizeText(userText);
  const explicitDoc = isExplicitDocumentQuestion(q);
  const shortThematic = isShortThematicQuestion(q);
  const retrieval = computeRetrievalStrength(topChunks);
  const hasEvidence = answerHasEnoughEvidence(userText, answerText);
  const weakText = isWeakAnswerText(answerText);
  const weakAnswer = weakText || !hasEvidence;

  if (explicitDoc) {
    return !answerText || weakText || !hasEvidence || retrieval.weak;
  }

  if (shortThematic) return retrieval.weak && weakAnswer;

  const thematicTerms = [
    "espacios confinados",
    "ventilacion",
    "ventilación",
    "oxigeno",
    "oxígeno",
    "soldadura blanda",
    "soldadura fuerte",
    "cilindros",
    "supresores de retroceso de llama",
    "retroceso de llama",
    "fundentes",
    "contratistas",
    "requisitos",
    "peligros",
    "deben usarse",
    "usarse"
  ];

  const thematicHit = thematicTerms.some((term) => q.includes(normalizeText(term)));
  if (thematicHit) return retrieval.weak && weakAnswer;

  return retrieval.weak && weakAnswer;
}


function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = Number(a[i]) || 0;
    const bi = Number(b[i]) || 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function truncateText(text = "", maxLen = 12000) {
  const s = String(text || "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n\n[contexto truncado]";
}

function safeErrorMessage(err) {
  const msg = err?.message || String(err) || "Sin detalle";
  return msg.slice(0, 1500);
}

function isQuotaExceededError(err) {
  const status = Number(err?.httpStatus || 0);
  const msg = normalizeText(err?.message || "");
  return status === 429 || msg.includes("resource_exhausted") || msg.includes("quota exceeded") || msg.includes("rate limit");
}

function splitIntoSentences(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30);
}

function scoreSentenceForQuestion(question = "", sentence = "") {
  const kw = keywordScoreDetailed(question, sentence);
  const sec = sectionMatchScore(question, sentence);
  const phr = phraseScore(question, sentence);
  const imp = importantTermBoost(question, sentence);
  return kw.score + sec + phr + imp;
}

function extractQuestionEvidenceTerms(question = "") {
  const stop = new Set([
    "de", "del", "la", "las", "el", "los", "un", "una", "unos", "unas",
    "y", "o", "u", "en", "por", "para", "con", "sin", "sobre", "respecto",
    "que", "qué", "cual", "cuál", "cuales", "cuáles", "como", "cómo", "se",
    "habla", "dice", "explica", "apartado", "seccion", "sección", "norma", "aws",
    "ansi", "z49", "tema", "eso", "anexo", "clausula", "cláusula", "inciso"
  ]);

  return unique(
    tokenize(question)
      .map((t) => normalizeText(t))
      .filter((t) => t.length >= 4 && !stop.has(t))
  );
}

function sentenceEvidenceStats(question = "", sentence = "") {
  const refs = extractSectionRefs(question);
  const terms = extractQuestionEvidenceTerms(question);
  const sentenceNorm = normalizeText(sentence);
  const refMatches = refs.filter((ref) => new RegExp(`\\b${escapeRegExp(ref)}\\b`, "i").test(String(sentence || "")));
  const termMatches = terms.filter((term) => sentenceNorm.includes(term));
  return {
    refs,
    terms,
    refMatches,
    termMatches,
    termCoverage: terms.length ? termMatches.length / terms.length : 0,
    hasStrongEvidence: refMatches.length > 0 || termMatches.length >= Math.min(2, Math.max(1, terms.length))
  };
}

function answerHasEnoughEvidence(question = "", answer = "") {
  const a = normalizeText(answer);
  if (!a) return false;
  const stats = sentenceEvidenceStats(question, answer);
  if (stats.refMatches.length > 0) return true;
  if (stats.termMatches.length >= Math.min(2, Math.max(1, stats.terms.length))) return true;
  if (a.length >= 180 && stats.termCoverage >= 0.34) return true;
  return false;
}

function chunkSourceLabel(chunk = {}) {
  // Etiqueta de fuente legible: "documento.pdf (pág. N)" si hay página; si no, el nombre.
  const name = chunk.source_name || chunk.file_name || "documento";
  const page = Number(chunk.page);
  return Number.isFinite(page) && page > 0 ? `${name} (pág. ${page})` : name;
}

function formatChunkSources(chunks = []) {
  const seen = new Set();
  const refs = [];
  for (const c of chunks || []) {
    const ref = chunkSourceLabel(c);
    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs.slice(0, 4).join(", ");
}

function summarizeTopDocuments(topChunks = [], limit = 3) {
  const byDoc = new Map();
  for (const chunk of topChunks || []) {
    const docId = Number(chunk.document_id || 0);
    if (!docId) continue;
    if (!byDoc.has(docId)) {
      byDoc.set(docId, {
        document_id: docId,
        file_name: chunk.source_name || "documento",
        score: 0,
        chunk_refs: [],
        chunk_count: 0,
      });
    }
    const entry = byDoc.get(docId);
    entry.score += Number(chunk.score || 0) + Number(chunk.semanticScore || 0) * 10;
    entry.chunk_count += 1;
    const ref = chunkSourceLabel(chunk);
    if (!entry.chunk_refs.includes(ref) && entry.chunk_refs.length < 4) entry.chunk_refs.push(ref);
  }
  return Array.from(byDoc.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}

function shouldUseSingleDocumentMode(question = "", topChunks = [], chosenDoc = null) {
  if (isExplicitDocumentQuestion(question)) return true;
  const docs = summarizeTopDocuments(topChunks, 3);
  if (!docs.length) return false;
  if (docs.length === 1) return true;
  const top = docs[0];
  const second = docs[1] || { score: 0, chunk_count: 0 };
  const totalScore = docs.reduce((sum, d) => sum + Number(d.score || 0), 0) || 1;
  const dominance = Number(top.score || 0) / totalScore;
  const clearLead = Number(top.score || 0) >= Number(second.score || 0) * 1.8;
  const chunkLead = Number(top.chunk_count || 0) >= Number(second.chunk_count || 0) + 2;
  const namedDoc = !!(chosenDoc && Number(chosenDoc.id || 0) === Number(top.document_id || 0));
  return dominance >= 0.68 && (clearLead || chunkLead || namedDoc);
}

function buildLocalChunkAnswer(question = "", topChunks = [], chosenDoc = null, options = {}) {
  const q = String(question || "").trim();
  const geminiUnavailable = options.geminiUnavailable !== false;
  const prefixUnavailable = geminiUnavailable
    ? "No pude consultar Gemini en este momento y el "
    : "El ";
  const prefixUsingLocal = geminiUnavailable
    ? "No pude consultar Gemini en este momento. Respondo con base en el índice local"
    : "Respondo con base en el índice local";
  const preferredDocId = Number(chosenDoc?.id || options.preferredDocumentId || 0) || null;
  let pool = (topChunks || []).filter(Boolean);
  if (preferredDocId) {
    const preferred = pool.filter((c) => Number(c.document_id || 0) === preferredDocId);
    if (preferred.length) pool = preferred.concat(pool.filter((c) => Number(c.document_id || 0) !== preferredDocId));
  }

  if (!pool.length) {
    return `${prefixUnavailable}índice local no encontró fragmentos suficientes para responder con confianza.`;
  }

  const refs = extractSectionRefs(q);
  const qTerms = extractQuestionEvidenceTerms(q);
  const sourceLabel = chosenDoc?.file_name || pool[0]?.source_name || "documento indexado";

  const bestSentences = [];
  const seen = new Set();
  for (const chunk of pool.slice(0, 6)) {
    const sentences = splitIntoSentences(chunk.content || "");
    const ranked = sentences
      .map((s) => {
        const score = scoreSentenceForQuestion(q, s);
        const evidence = sentenceEvidenceStats(q, s);
        return { text: s, score, evidence, chunk };
      })
      .sort((a, b) => b.score - a.score);

    for (const item of ranked) {
      const key = normalizeText(item.text);
      if (seen.has(key)) continue;
      if (!item.evidence.hasStrongEvidence) continue;
      if (item.score < 4.5 && item.evidence.refMatches.length === 0) continue;
      seen.add(key);
      bestSentences.push(item);
      if (bestSentences.length >= 5) break;
    }
    if (bestSentences.length >= 5) break;
  }

  const hasSectionRef = refs.length > 0;
  const hasStrongSentenceEvidence = bestSentences.some((item) => item.evidence.refMatches.length > 0 || item.evidence.termMatches.length >= 2);
  const hasQuestionTermEvidence = bestSentences.some((item) => item.evidence.termCoverage >= 0.5 || item.evidence.termMatches.length >= Math.min(2, Math.max(1, qTerms.length)));

  if (!bestSentences.length || (hasSectionRef && !hasStrongSentenceEvidence) || (!hasSectionRef && !hasQuestionTermEvidence)) {
    const sources = formatChunkSources(pool.slice(0, 3));
    return [
      `${prefixUnavailable}índice local no contiene evidencia suficiente para responder con precisión sobre "${q}".`,
      chosenDoc?.file_name ? `Documento priorizado: ${chosenDoc.file_name}.` : null,
      sources ? `Fragmentos revisados: ${sources}` : null
    ].filter(Boolean).join("\n");
  }

  const lines = [
    `${prefixUsingLocal} de ${sourceLabel}.`,
    ""
  ];

  bestSentences.slice(0, 3).forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.text}`);
  });

  const sources = formatChunkSources(bestSentences.map((s) => s.chunk));
  if (sources) {
    lines.push("");
    lines.push(`Fuentes locales: ${sources}`);
  }

  return lines.join("\n");
}

function buildMultiDocumentLocalAnswer(question = "", topChunks = [], options = {}) {
  const q = String(question || "").trim();
  const geminiUnavailable = options.geminiUnavailable !== false;
  const prefixUnavailable = geminiUnavailable
    ? "No pude consultar Gemini en este momento y el "
    : "El ";
  const prefixUsingLocal = geminiUnavailable
    ? "No pude consultar Gemini en este momento. Respondo con una síntesis del índice local usando varios PDFs."
    : "Respondo con una síntesis del índice local usando varios PDFs.";
  const pool = (topChunks || []).filter(Boolean);
  if (!pool.length) {
    return `${prefixUnavailable}índice local no encontró fragmentos suficientes para responder con confianza.`;
  }

  const candidates = [];
  const seen = new Set();
  for (const chunk of pool.slice(0, 8)) {
    for (const sentence of splitIntoSentences(chunk.content || "")) {
      const evidence = sentenceEvidenceStats(q, sentence);
      const score = scoreSentenceForQuestion(q, sentence) + Number(chunk.semanticScore || 0) * 2;
      const key = normalizeText(sentence);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!evidence.hasStrongEvidence && score < 5.5) continue;
      candidates.push({ text: sentence, score, evidence, chunk });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  const usedDocs = new Set();
  for (const item of candidates) {
    const docId = Number(item.chunk.document_id || 0);
    if (selected.length >= 4) break;
    if (usedDocs.has(docId) && selected.length >= 2 && item.score < 7) continue;
    selected.push(item);
    usedDocs.add(docId);
  }

  const summaryDocs = summarizeTopDocuments(pool, 3);
  const enoughEvidence = selected.length >= 2 && (usedDocs.size >= 2 || selected.some((item) => item.evidence.refMatches.length > 0 || item.evidence.termCoverage >= 0.5));
  if (!enoughEvidence) {
    const sources = summaryDocs.flatMap((d) => d.chunk_refs).slice(0, 5).join(", ");
    const docList = summaryDocs.map((d) => d.file_name).join(", ");
    return [
      `${prefixUnavailable}índice local no contiene evidencia suficiente para responder con precisión sobre "${q}".`,
      docList ? `Documentos revisados: ${docList}.` : null,
      sources ? `Fragmentos revisados: ${sources}` : null
    ].filter(Boolean).join("\n");
  }

  const lines = [
    prefixUsingLocal,
    ""
  ];
  selected.slice(0, 3).forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.text}`);
  });
  const docList = summaryDocs.map((d) => d.file_name).join(", ");
  const sources = selected.map((item) => chunkSourceLabel(item.chunk))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 5)
    .join(", ");
  if (docList) {
    lines.push("");
    lines.push(`Documentos consultados: ${docList}`);
  }
  if (sources) {
    lines.push(`Fuentes locales: ${sources}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Funciones auxiliares para reintentos y errores HTTP.
// (Estaban referenciadas en el código pero no definidas: su ausencia rompía
//  el polling de Gemini y toda la lógica de reintento ante errores transitorios.)
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function backoffMs(attempt) {
  // Backoff exponencial con jitter: ~0.5s, 1s, 2s, 4s... tope 8s.
  const n = Math.max(0, Number(attempt) || 0);
  const base = Math.min(500 * Math.pow(2, n), 8000);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function makeHttpError(label, status, body) {
  const detail = typeof body === "string" ? body.slice(0, 500) : "";
  const err = new Error(`${label} (HTTP ${status})${detail ? `: ${detail}` : ""}`);
  err.httpStatus = Number(status) || 0;
  return err;
}

function queueRetryDelaySeconds(attempts) {
  // 60s en el primer reintento, 120s en el segundo, tope 300s.
  const a = Math.max(1, Number(attempts) || 1);
  return Math.min(60 * a, 300);
}

function isRetryableError(err) {
  if (err?.retryable === true) return true;
  if (err?.retryable === false) return false;

  const status = err?.httpStatus;
  if ([429, 500, 502, 503, 504, 524].includes(Number(status))) return true;

  const msg = normalizeText(err?.message || "");
  return (
    msg.includes("timeout") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("unavailable") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("524") ||
    msg.includes("503") ||
    msg.includes("429")
  );
}

function retryAfterMs(resp, body, attempt) {
  // Honra el tiempo de espera del 429 (cabecera Retry-After o "retry in Xs" del
  // cuerpo), con un tope CORTO de 12s para no colgar el queue consumer.
  const cap = 12000;
  try {
    const header = resp?.headers?.get?.("retry-after");
    if (header) {
      const secs = Number(header);
      if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000 + 500, cap);
    }
  } catch (_) { /* noop */ }

  const m = String(body || "").match(/retry in\s+([\d.]+)\s*s/i);
  if (m) {
    const secs = Number(m[1]);
    if (Number.isFinite(secs) && secs > 0) return Math.min(Math.ceil(secs) * 1000 + 500, cap);
  }

  return Math.min(backoffMs(attempt), cap);
}

async function fetchJsonWithRetry(url, options, retryOptions = {}) {
  const {
    maxRetries = 3,
    label = "request",
    retryOnStatuses = [429, 500, 502, 503, 504, 524],
  } = retryOptions;

  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options);

      if (!resp.ok) {
        const text = await resp.text();

        if (retryOnStatuses.includes(resp.status) && attempt < maxRetries) {
          const wait = resp.status === 429 ? retryAfterMs(resp, text, attempt) : backoffMs(attempt);
          console.log("fetch_retry", JSON.stringify({ label, status: resp.status, attempt, waitMs: wait }));
          await sleep(wait);
          continue;
        }

        throw makeHttpError(`${label} error`, resp.status, text);
      }

      return await resp.json();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt >= maxRetries) throw err;
      await sleep(backoffMs(attempt));
    }
  }

  throw lastErr || new Error(`${label} failed after retries`);
}

function getAnswerModel(env) {
  return env.GEMINI_ANSWER_MODEL || "gemini-2.5-flash";
}

function getEmbeddingModel(env) {
  return env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
}

function getPdfModel(env) {
  return env.GEMINI_PDF_MODEL || "gemini-2.5-flash";
}

function getGeminiApiKeyHeader(env) {
  return { "x-goog-api-key": env.GEMINI_API_KEY };
}

function unwrapGeminiFilePayload(data) {
  return data?.file || data || null;
}

async function sendTelegramMessage(env, chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Telegram sendMessage error ${resp.status}: ${err}`);
  }
}

async function telegramGetFile(env, fileId) {
  const resp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await resp.json();
  if (!data.ok) throw new Error("No pude obtener file_path de Telegram.");
  return data.result;
}

async function telegramDownloadFile(env, filePath) {
  const resp = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!resp.ok) throw new Error(`No pude descargar el archivo desde Telegram. HTTP ${resp.status}`);
  return await resp.arrayBuffer();
}

async function startGeminiResumableUpload(env, mimeType, numBytes, displayName) {
  const resp = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      ...getGeminiApiKeyHeader(env),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(numBytes),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file: {
        display_name: displayName || "document.pdf",
      },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw makeHttpError("Gemini resumable upload start error", resp.status, txt);
  }

  const uploadUrl = resp.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini no devolvió x-goog-upload-url.");
  return uploadUrl;
}

async function finalizeGeminiUpload(env, uploadUrl, fileBytes) {
  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(fileBytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: fileBytes,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw makeHttpError("Gemini resumable upload finalize error", resp.status, txt);
  }

  const data = await resp.json();
  const file = unwrapGeminiFilePayload(data);
  if (!file?.name || !file?.uri) throw new Error("Gemini no devolvió metadata válida del archivo tras el upload.");
  return file;
}

async function uploadPdfToGeminiFiles(env, fileBytes, fileName = "document.pdf", mimeType = "application/pdf") {
  const uploadUrl = await startGeminiResumableUpload(env, mimeType, fileBytes.byteLength, fileName);
  return await finalizeGeminiUpload(env, uploadUrl, fileBytes);
}

async function getGeminiFile(env, fileName) {
  const data = await fetchJsonWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
    {
      method: "GET",
      headers: { ...getGeminiApiKeyHeader(env) },
    },
    {
      maxRetries: 2,
      label: `Gemini files.get (${fileName})`,
    }
  );

  const file = unwrapGeminiFilePayload(data);
  if (!file?.name) throw new Error(`Gemini files.get no devolvió archivo válido para ${fileName}`);
  return file;
}

async function deleteGeminiFile(env, fileName) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
    method: "DELETE",
    headers: { ...getGeminiApiKeyHeader(env) },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw makeHttpError("Gemini files.delete error", resp.status, txt);
  }
}

async function waitForGeminiFileActive(env, fileName, options = {}) {
  const { maxWaitMs = 90000, pollIntervalMs = 2500 } = options;
  const startedAt = Date.now();
  let lastFile = null;

  while (Date.now() - startedAt < maxWaitMs) {
    const file = await getGeminiFile(env, fileName);
    lastFile = file;
    const state = String(file.state || "STATE_UNSPECIFIED").toUpperCase();

    if (state === "ACTIVE") return file;

    if (state === "FAILED") {
      const statusText =
        file?.error?.message ||
        file?.status?.message ||
        "El archivo falló durante el procesamiento en Gemini.";
      const err = new Error(statusText);
      err.retryable = false;
      throw err;
    }

    await sleep(pollIntervalMs);
  }

  const err = new Error(`Timeout esperando archivo Gemini ACTIVE. Último estado: ${lastFile?.state || "desconocido"}`);
  err.retryable = true;
  throw err;
}

async function extractPdfPageCount(env, model, fileUri, mimeType) {
  try {
    const data = await fetchJsonWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { ...getGeminiApiKeyHeader(env), "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { file_data: { mime_type: mimeType, file_uri: fileUri } },
              { text: "¿Cuántas páginas tiene este documento PDF? Responde únicamente con el número entero, sin texto adicional." },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 16, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
      { maxRetries: 2, label: `Gemini PDF pagecount (${model})` }
    );
    const t = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join(" ") || "";
    const m = t.replace(/[.,\s]/g, "").match(/\d+/);
    const n = m ? Number(m[0]) : 0;
    return Number.isFinite(n) && n > 0 && n < 2000 ? n : 0;
  } catch (err) {
    console.error("pagecount probe error:", err?.message || String(err));
    return 0;
  }
}

async function extractPdfPageRange(env, model, fileUri, mimeType, startPage, endPage) {
  const data = await fetchJsonWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { ...getGeminiApiKeyHeader(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
            { text: [
              `Extrae el texto de las páginas ${startPage} a ${endPage} de este PDF, con la mayor fidelidad posible.`,
              "No resumas. No omitas secciones dentro de ese rango.",
              "Conserva encabezados, numeración, listas y tablas como texto plano cuando sea posible.",
              "Mantén los títulos y numerales (por ejemplo E5.1, 5.2) como aparecen en el documento.",
              "MUY IMPORTANTE: antes del texto de CADA página, escribe en una línea propia el marcador",
              "exacto: ==Start of OCR for page N== (donde N es el número real de página del PDF).",
              "Hazlo en todas las páginas del rango, tengan o no capa de texto, sin excepción.",
              "Si ese rango de páginas no existe en el documento, responde exactamente: SIN_CONTENIDO.",
              "Devuelve únicamente el texto extraído con sus marcadores, sin comentarios adicionales.",
            ].join(" ") },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
    { maxRetries: 2, label: `Gemini PDF extract p${startPage}-${endPage} (${model})` }
  );
  return data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("\n").trim() || "";
}

async function extractPdfTextWithGeminiFilesApi(env, fileBytes, fileName = "document.pdf", mimeType = "application/pdf") {
  let uploadedFile = null;

  try {
    uploadedFile = await uploadPdfToGeminiFiles(env, fileBytes, fileName, mimeType);
    const activeFile = await waitForGeminiFileActive(env, uploadedFile.name, {
      maxWaitMs: 90000,
      pollIntervalMs: 2500,
    });

    const model = getPdfModel(env);

    // Extracción por lotes de páginas: cada llamada es corta (evita el timeout 524)
    // y juntas capturan el documento completo (evita el truncado a 8k tokens).
    const BATCH = 5;        // páginas por llamada (pág. 11 = E5.1 cae al inicio de su lote)
    const HARD_CAP = 60;    // máx. 60 lotes (~360 páginas) como salvaguarda
    const pageCount = await extractPdfPageCount(env, model, activeFile.uri, mimeType);
    console.log("pdf_pagecount", JSON.stringify({ fileName, pageCount }));

    const segments = [];
    const failedRanges = [];
    let emptyStreak = 0;

    for (let i = 0, start = 1; i < HARD_CAP; i++, start += BATCH) {
      if (pageCount > 0 && start > pageCount) break;
      const end = pageCount > 0 ? Math.min(start + BATCH - 1, pageCount) : start + BATCH - 1;

      let seg = "";
      let failed = false;
      try {
        seg = await extractPdfPageRange(env, model, activeFile.uri, mimeType, start, end);
      } catch (err) {
        console.error("pdf_extract_batch.error", JSON.stringify({ start, end, msg: err?.message || String(err) }));
        failed = true;
      }

      const clean = seg.replace(/\s+/g, " ").trim();
      console.log("pdf_extract_batch", JSON.stringify({ start, end, len: seg.length, failed }));

      if (failed) {
        // Un fallo (p. ej. 429 por rate limit) NO significa fin del documento:
        // lo registramos para reintentarlo y seguimos con los demás lotes.
        failedRanges.push([start, end]);
        emptyStreak = 0;
        continue;
      }

      if (!clean || /^SIN_CONTENIDO\b/i.test(clean)) {
        // Vacío real: solo cuenta como "fin del documento" si NO conocemos el total.
        if (pageCount === 0) {
          emptyStreak++;
          if (emptyStreak >= 2) break;
        }
        continue;
      }

      emptyStreak = 0;
      // Ancla de página por lote: garantiza al menos una página por región aunque
      // Gemini omita algún marcador en páginas con capa de texto digital.
      segments.push(`==Start of OCR for page ${start}==\n${seg}`);
    }

    // Segunda pasada: reintentar los lotes que fallaron (la cuota suele haberse
    // recuperado tras procesar el resto). Espera breve entre reintentos.
    for (const [start, end] of failedRanges) {
      try {
        await sleep(2000);
        const seg = await extractPdfPageRange(env, model, activeFile.uri, mimeType, start, end);
        const clean = seg.replace(/\s+/g, " ").trim();
        console.log("pdf_extract_retry", JSON.stringify({ start, end, len: seg.length }));
        if (clean && !/^SIN_CONTENIDO\b/i.test(clean)) segments.push(`==Start of OCR for page ${start}==\n${seg}`);
      } catch (err) {
        console.error("pdf_extract_retry.error", JSON.stringify({ start, end, msg: err?.message || String(err) }));
      }
    }

    const text = segments.join("\n\n").trim();

    if (!text) {
      const err = new Error("Gemini no devolvió texto al extraer el PDF.");
      err.retryable = false;
      throw err;
    }

    console.log("pdf_extract_total", JSON.stringify({
      fileName, batches: segments.length, failedRanges: failedRanges.length, chars: text.length
    }));
    return text;
  } finally {
    if (uploadedFile?.name) {
      try {
        await deleteGeminiFile(env, uploadedFile.name);
      } catch (err) {
        console.error("Gemini file cleanup error:", err?.message || String(err));
      }
    }
  }
}

function getExtractionMode(env) {
  // "gemini" (por defecto, Camino B): extracción por Gemini (I/O, sin CPU local).
  // "unpdf": extracción local con unpdf (rápida, pero usa CPU; requiere Workers de pago).
  // "auto": intenta unpdf y, si falla, cae a Gemini.
  const m = String(env.EXTRACTION_MODE || "gemini").toLowerCase();
  return ["gemini", "unpdf", "auto"].includes(m) ? m : "gemini";
}

async function extractPdfText(env, fileBytes, fileName = "document.pdf", mimeType = "application/pdf") {
  const mode = getExtractionMode(env);
  console.log("pdf_extract_mode", JSON.stringify({ fileName, mode }));

  // Camino B (por defecto): extracción por Gemini Files API, sin tocar unpdf/CPU local.
  if (mode === "gemini") {
    return await extractPdfTextWithGeminiFilesApi(env, fileBytes, fileName, mimeType);
  }

  // Modos "unpdf" / "auto": extracción LOCAL con unpdf primero.
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(fileBytes));
    // Extracción POR PÁGINA para poder anteponer el marcador de página a cada una;
    // así splitIntoPageChunks conserva la cita por página (igual que con Gemini).
    const result = await extractText(pdf, { mergePages: false });
    const pagesArr = Array.isArray(result?.text) ? result.text : [String(result?.text || "")];
    const marked = pagesArr
      .map((t, i) => `==Start of OCR for page ${i + 1}==\n${String(t || "")}`)
      .join("\n\n");
    const clean = marked.trim();
    const chars = pagesArr.join("").length;
    console.log("pdf_extract_unpdf", JSON.stringify({
      fileName, totalPages: result?.totalPages || pagesArr.length, chars,
    }));
    if (chars >= 500) return clean;
    console.log("unpdf devolvió poco texto; usando Gemini Files API como respaldo.");
  } catch (err) {
    console.error("unpdf error, respaldo a Gemini:", err?.message || String(err));
  }

  // Respaldo: extracción por lotes con Gemini Files API.
  return await extractPdfTextWithGeminiFilesApi(env, fileBytes, fileName, mimeType);
}

async function askPdfDirect(env, fileBytes, fileName, mimeType, question) {
  let uploadedFile = null;

  try {
    uploadedFile = await uploadPdfToGeminiFiles(env, fileBytes, fileName, mimeType);
    const activeFile = await waitForGeminiFileActive(env, uploadedFile.name, {
      maxWaitMs: 90000,
      pollIntervalMs: 2500,
    });

    const model = getAnswerModel(env);

    const prompt = [
      "Responde la pregunta usando exclusivamente el contenido del PDF adjunto.",
      "Si el PDF no contiene la respuesta, dilo claramente.",
      "No inventes información.",
      "Responde en español, en texto plano.",
      "No uses markdown.",
      "No uses negritas, asteriscos ni viñetas especiales.",
      "Si enumeras elementos, usa formato simple como 1., 2., 3.",
      "Al final, si usaste el contenido del PDF, agrega una línea de fuentes citando el",
      "documento y la PÁGINA donde se encuentra la información, con este formato exacto:",
      `Fuentes: ${fileName || "documento.pdf"} (pág. N)`,
      "donde N es el número de página del PDF. Si aplican varias páginas, sepáralas con comas.",
      "",
      `Pregunta: ${question}`
    ].join("\n");

    const data = await fetchJsonWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          ...getGeminiApiKeyHeader(env),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  file_data: {
                    mime_type: mimeType,
                    file_uri: activeFile.uri,
                  },
                },
                { text: prompt }
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1400,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
      {
        maxRetries: 3,
        label: `Gemini direct PDF QA (${model})`,
      }
    );

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || "")
        .join("\n")
        .trim() || "";

    if (!text) {
      throw new Error("Gemini no devolvió respuesta para la consulta directa al PDF.");
    }

    return text;
  } finally {
    if (uploadedFile?.name) {
      try {
        await deleteGeminiFile(env, uploadedFile.name);
      } catch (err) {
        console.error("Gemini file cleanup error (askPdfDirect):", err?.message || String(err));
      }
    }
  }
}

async function getEmbeddingsBatch(env, texts) {
  // Genera embeddings de múltiples textos en pocas llamadas (batchEmbedContents),
  // en vez de una llamada por chunk. Reduce muchísimo los subrequests y el rate limit.
  const model = getEmbeddingModel(env);
  const all = [];
  const GROUP = 100; // máx. solicitudes por llamada batch

  for (let i = 0; i < texts.length; i += GROUP) {
    const slice = texts.slice(i, i + GROUP);
    const data = await fetchJsonWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: slice.map((t) => ({
            model: `models/${model}`,
            content: { parts: [{ text: t }] },
          })),
        }),
      },
      { maxRetries: 3, label: `Gemini batch embedding (${model}) x${slice.length}` }
    );

    const embeddings = data?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== slice.length) {
      throw new Error(`batchEmbedContents devolvió ${embeddings?.length || 0} embeddings, se esperaban ${slice.length}.`);
    }
    for (const e of embeddings) {
      const values = e?.values;
      if (!Array.isArray(values) || !values.length) throw new Error("Embedding inválido en el lote.");
      all.push(values);
    }
  }

  return all;
}

async function getEmbedding(env, text) {
  const model = getEmbeddingModel(env);

  const data = await fetchJsonWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }),
    },
    {
      maxRetries: 2,
      label: `Gemini embedding (${model})`,
    }
  );

  const values = data?.embedding?.values;
  if (!Array.isArray(values) || !values.length) throw new Error("Gemini no devolvió embedding válido.");
  return values;
}

async function callGeminiAnswer(env, userText, intent, contextText, conversationText = "") {
  const model = getAnswerModel(env);

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

  const data = await fetchJsonWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `
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
`.trim(),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1400,
          // Gemini 2.5 Flash trae "thinking" activo por defecto y esos tokens
          // se descuentan de maxOutputTokens, truncando la respuesta visible.
          // Lo apagamos para que todo el presupuesto sea respuesta para el usuario.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
    {
      maxRetries: 4,
      label: `Gemini answer (${model})`,
    }
  );

  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text || "")
      .join("")
      .trim() || ""
  );
}

async function saveMessage(env, chatId, role, text, intent = null) {
  const intentValue = typeof intent === "string" || intent == null ? intent : JSON.stringify(intent);
  await env.DB.prepare(
    `INSERT INTO messages (chat_id, role, text, intent) VALUES (?, ?, ?, ?)`
  ).bind(String(chatId), role, text, intentValue).run();
}

function isSourceQuestion(text = "") {
  const t = normalizeText(text);
  return /(de donde sacaste|de dónde sacaste|cual fue la fuente|cuál fue la fuente|fuente de esta informacion|fuente de esta información|en que documento|en qué documento|de que documento|de qué documento|de que pdf|de qué pdf|de donde lo obtuviste|de dónde lo obtuviste|que fuente usaste|qué fuente usaste)/.test(t);
}

async function getLastAssistantMessageMeta(env, chatId) {
  const row = await env.DB.prepare(
    `SELECT text, intent
     FROM messages
     WHERE chat_id = ? AND role = 'assistant'
     ORDER BY id DESC
     LIMIT 1`
  ).bind(String(chatId)).first();

  if (!row) return null;

  let meta = null;
  try {
    meta = row.intent ? JSON.parse(row.intent) : null;
  } catch {
    meta = null;
  }

  return {
    text: row.text || "",
    meta,
  };
}

function buildSourceAnswerFromMeta(lastAssistant) {
  const meta = lastAssistant?.meta || {};
  const parts = ["La respuesta anterior se generó con estas fuentes:"];

  if (meta.source) parts.push(`- Ruta usada: ${meta.source}`);
  if (meta.fileName) parts.push(`- Documento principal: ${meta.fileName}`);
  if (Array.isArray(meta.documents) && meta.documents.length) {
    parts.push(`- Documentos considerados: ${meta.documents.map((d) => d.file_name).join(", ")}`);
  }
  if (meta.query) parts.push(`- Consulta interpretada: ${meta.query}`);
  if (Array.isArray(meta.sources) && meta.sources.length) {
    parts.push(`- Fragmentos consultados: ${meta.sources.join(", ")}`);
  }

  if (!meta.source && !meta.fileName && !(Array.isArray(meta.sources) && meta.sources.length) && !(Array.isArray(meta.documents) && meta.documents.length)) {
    return "No tengo metadatos suficientes de la respuesta anterior para indicar con precisión la fuente usada.";
  }

  return parts.join("\n");
}

async function saveDocument(env, chatId, doc) {
  const res = await env.DB.prepare(
    `INSERT INTO documents (
      chat_id,
      telegram_file_id,
      telegram_file_unique_id,
      file_name,
      mime_type,
      status,
      attempts,
      last_error,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  )
    .bind(
      String(chatId),
      doc.file_id,
      doc.file_unique_id || null,
      doc.file_name || null,
      doc.mime_type || null,
      "pending",
      0,
      null
    )
    .run();

  return res.meta.last_row_id;
}

async function updateDocumentStatus(env, documentId, status, lastError = null) {
  await env.DB.prepare(
    `UPDATE documents
     SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(status, lastError, Number(documentId)).run();
}

async function resetDocumentForReindex(env, documentId) {
  await env.DB.prepare(
    `UPDATE documents
     SET status = 'pending',
         attempts = 0,
         last_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(Number(documentId)).run();
}

async function markDocumentProcessingAttempt(env, documentId) {
  await env.DB.prepare(
    `UPDATE documents
     SET status = ?,
         attempts = COALESCE(attempts, 0) + 1,
         last_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind("processing", Number(documentId)).run();
}

async function clearChunksForDocument(env, documentId) {
  await env.DB.prepare(`DELETE FROM chunks WHERE document_id = ?`).bind(Number(documentId)).run();
}

async function saveChunks(env, chatId, documentId, fileName, chunks) {
  if (!chunks.length) return;

  // Acepta chunks como strings o como objetos { content, page }.
  const items = chunks.map((c) => (typeof c === "string" ? { content: c, page: null } : c));
  const contents = items.map((c) => c.content);

  // 1) Embeddings de todos los chunks en pocas llamadas (no una por chunk).
  const embeddings = await getEmbeddingsBatch(env, contents);

  // 2) Inserciones agrupadas con DB.batch() (en lotes) en vez de una por chunk.
  const DB_BATCH = 50;
  for (let i = 0; i < items.length; i += DB_BATCH) {
    const stmts = [];
    for (let j = i; j < Math.min(i + DB_BATCH, items.length); j++) {
      const pageVal = Number.isFinite(Number(items[j].page)) && Number(items[j].page) > 0
        ? Number(items[j].page)
        : null;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO chunks (
            document_id, chat_id, source_name, chunk_index, page, content, embedding, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
          Number(documentId),
          String(chatId),
          fileName || "document.pdf",
          j,
          pageVal,
          items[j].content,
          JSON.stringify(embeddings[j])
        )
      );
    }
    await env.DB.batch(stmts);
  }
}

async function getTopChunksSemantic(env, chatId, query, limit = 8) {
  const queryEmbedding = await getEmbedding(env, query);

  const rows = await env.DB.prepare(
    `SELECT id, document_id, source_name, chunk_index, page, content, embedding
     FROM chunks
     WHERE chat_id = ?
     ORDER BY id DESC
     LIMIT 600`
  ).bind(String(chatId)).all();

  return (rows.results || [])
    .map((r) => {
      let semanticScore = 0;
      try {
        const emb = JSON.parse(r.embedding || "null");
        semanticScore = cosineSimilarity(queryEmbedding, emb);
      } catch {
        semanticScore = 0;
      }

      const kw = keywordScoreDetailed(query, r.content);
      const phr = phraseScore(query, r.content);
      const sec = sectionMatchScore(query, r.content);
      const imp = importantTermBoost(query, r.content);

      const finalScore =
        semanticScore * 10 +
        kw.score * 1.8 +
        phr * 1.5 +
        sec * 2.5 +
        imp;

      return {
        ...r,
        semanticScore,
        keywordScore: kw.score,
        keywordMatched: kw.matched,
        keywordCoverage: kw.coverage,
        phraseScore: phr,
        sectionScore: sec,
        importantBoost: imp,
        score: finalScore,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function searchChunksByTerm(env, chatId, documentId, term, limit = 8) {
  const rows = await env.DB.prepare(
    `SELECT chunk_index, page, content
     FROM chunks
     WHERE chat_id = ? AND document_id = ?
     ORDER BY chunk_index ASC`
  ).bind(String(chatId), Number(documentId)).all();

  const q = normalizeText(term);

  return (rows.results || [])
    .map((r) => {
      const kw = keywordScoreDetailed(term, r.content);
      const phr = phraseScore(term, r.content);
      const sec = sectionMatchScore(term, r.content);
      const imp = importantTermBoost(term, r.content);
      const score = kw.score * 2 + phr * 1.5 + sec * 2.5 + imp;

      return { ...r, score };
    })
    .filter((r) => r.score > 0 || normalizeText(r.content).includes(q))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function getDocumentsForChat(env, chatId, limit = 10) {
  const rows = await env.DB.prepare(
    `SELECT
       d.id,
       d.file_name,
       d.status,
       d.attempts,
       d.last_error,
       d.created_at,
       d.updated_at,
       COALESCE(c.chunk_count, 0) AS chunk_count
     FROM documents d
     LEFT JOIN (
       SELECT document_id, COUNT(*) AS chunk_count
       FROM chunks
       GROUP BY document_id
     ) c ON c.document_id = d.id
     WHERE d.chat_id = ?
     ORDER BY d.id DESC
     LIMIT ?`
  ).bind(String(chatId), Number(limit)).all();

  return rows.results || [];
}

async function getDocumentByIdForChat(env, chatId, documentId) {
  return await env.DB.prepare(
    `SELECT id, chat_id, telegram_file_id, file_name, mime_type, status, attempts, last_error
     FROM documents
     WHERE chat_id = ? AND id = ?
     LIMIT 1`
  ).bind(String(chatId), Number(documentId)).first();
}

async function getLatestCompletedDocumentForChat(env, chatId) {
  return await env.DB.prepare(
    `SELECT id, chat_id, telegram_file_id, file_name, mime_type, status, attempts, last_error
     FROM documents
     WHERE chat_id = ? AND status = 'completed'
     ORDER BY id DESC
     LIMIT 1`
  ).bind(String(chatId)).first();
}

async function getCompletedDocumentsForChat(env, chatId, limit = 25) {
  const rows = await env.DB.prepare(
    `SELECT id, chat_id, telegram_file_id, file_name, mime_type, status, attempts, last_error
     FROM documents
     WHERE chat_id = ? AND status = 'completed'
     ORDER BY id DESC
     LIMIT ?`
  ).bind(String(chatId), Number(limit)).all();

  return rows.results || [];
}

async function getPreviousUsefulUserMessage(env, chatId) {
  const row = await env.DB.prepare(
    `SELECT text
     FROM messages
     WHERE chat_id = ? AND role = 'user'
     ORDER BY id DESC
     LIMIT 1`
  ).bind(String(chatId)).first();

  return row?.text || "";
}

async function getRecentConversation(env, chatId, limit = 6) {
  // Devuelve los últimos turnos (usuario/asistente) en orden cronológico,
  // para dar contexto conversacional a Gemini en preguntas de seguimiento.
  const rows = await env.DB.prepare(
    `SELECT role, text
     FROM messages
     WHERE chat_id = ?
     ORDER BY id DESC
     LIMIT ?`
  ).bind(String(chatId), Number(limit)).all();

  return (rows.results || [])
    .reverse()
    .map((r) => {
      const who = r.role === "assistant" ? "ASISTENTE" : "USUARIO";
      const t = String(r.text || "").replace(/\s+/g, " ").trim().slice(0, 600);
      return t ? `${who}: ${t}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

function scoreDocumentCandidates(question, documents = [], topChunks = []) {
  const q = normalizeText(question);
  const refs = extractSectionRefs(question);
  const qTerms = extractQuestionEvidenceTerms(question);
  const hasAwsMention = /\baws\b|aws_z49|z49|ansi/.test(q);
  const hasSectionRef = refs.length > 0;
  const awsStyleRef = refs.some((r) => /^[ef]\d+(?:\.\d+){0,5}$/i.test(r));
  const docMap = new Map();

  for (const d of documents) {
    docMap.set(Number(d.id), {
      ...d,
      autoScore: 0,
    });
  }

  for (const chunk of topChunks || []) {
    const docId = Number(chunk.document_id || 0);
    if (!docMap.has(docId)) continue;
    const entry = docMap.get(docId);
    const content = String(chunk.content || "");
    const evidence = sentenceEvidenceStats(question, content);

    entry.autoScore += Number(chunk.score || 0);
    entry.autoScore += Number(chunk.semanticScore || 0) * 8;
    entry.autoScore += Number(chunk.keywordScore || 0) * 1.5;
    entry.autoScore += Number(chunk.sectionScore || 0) * 2.5;
    if (refs.length && sectionMatchScore(question, content) > 0) {
      entry.autoScore += 65;
    }
    if (evidence.refMatches.length) entry.autoScore += 55;
    if (evidence.termMatches.length >= 2) entry.autoScore += 10;
    if (chunk.content && isExplicitDocumentQuestion(question)) {
      entry.autoScore += keywordScoreDetailed(question, content).score * 1.5;
      entry.autoScore += phraseScore(question, content);
    }
  }

  for (const entry of docMap.values()) {
    const fileNameNorm = normalizeText(entry.file_name || "");
    const fileNameCompact = fileNameNorm.replace(/[^a-z0-9]+/g, " ");
    const isAwsDoc = /aws|z49|ansi/.test(fileNameNorm);
    const isManualDoc = /manual|oxgasa|wi-2000/.test(fileNameNorm) && !isAwsDoc;

    if (fileNameNorm) {
      const nameTokens = tokenize(fileNameNorm).filter((t) => t.length >= 3);
      let nameHit = 0;
      for (const token of nameTokens) {
        if (q.includes(token)) nameHit += 1;
      }
      entry.autoScore += nameHit * 3;
      if (q.includes("aws") && fileNameNorm.includes("aws")) entry.autoScore += 26;
      if (q.includes("ansi") && fileNameNorm.includes("ansi")) entry.autoScore += 18;
      if (q.includes("z49") && /z49|z\s*49/.test(fileNameCompact)) entry.autoScore += 42;
      if ((q.includes("aws_z49") || q.includes("aws z49")) && /aws|z49/.test(fileNameNorm)) entry.autoScore += 55;
      if (q.includes("norma") && /aws_z49|z49/.test(fileNameNorm)) entry.autoScore += 18;
      if (q.includes("wi-2000") && fileNameCompact.includes("wi 2000")) entry.autoScore += 22;
      if ((q.includes("manual") || q.includes("oxigeno") || q.includes("oxígeno")) && fileNameCompact.includes("oxgasa")) entry.autoScore += 10;
    }

    if (hasSectionRef && isAwsDoc) entry.autoScore += 45;
    if (awsStyleRef && isAwsDoc) entry.autoScore += 90;
    if (hasAwsMention && isAwsDoc) entry.autoScore += 70;
    if (hasSectionRef && isManualDoc) entry.autoScore -= 35;
    if (awsStyleRef && isManualDoc) entry.autoScore -= 55;
    if (hasAwsMention && isManualDoc) entry.autoScore -= 40;

    if (qTerms.some((term) => /supresor|retroceso|llama|cilindro|oxigeno|oxígeno|ventilacion|ventilación|confinad/.test(term))) {
      if (/oxgasa|manual/.test(fileNameNorm)) entry.autoScore += 8;
      if (/aws_z49|z49/.test(fileNameNorm) && /(ventilacion|ventilación|confinad|cilindro|oxigeno|oxígeno)/.test(q)) entry.autoScore += 20;
    }
  }

  return Array.from(docMap.values()).sort((a, b) => b.autoScore - a.autoScore);
}

async function chooseBestDocumentForQuestion(env, chatId, question, topChunks = []) {
  const docs = await getCompletedDocumentsForChat(env, chatId, 25);
  if (!docs.length) return null;
  if (docs.length === 1) return docs[0];

  const ranked = scoreDocumentCandidates(question, docs, topChunks);
  return ranked[0] || docs[0];
}


async function getErroredDocumentsForChat(env, chatId, limit = 10) {
  const rows = await env.DB.prepare(
    `SELECT
       d.id,
       d.file_name,
       d.status,
       d.attempts,
       d.last_error,
       d.updated_at
     FROM documents d
     WHERE d.chat_id = ?
       AND (d.status = 'failed' OR d.last_error IS NOT NULL)
     ORDER BY d.updated_at DESC, d.id DESC
     LIMIT ?`
  ).bind(String(chatId), Number(limit)).all();

  return rows.results || [];
}

async function getChunkPreviewForDocument(env, chatId, documentId, limit = 3) {
  const rows = await env.DB.prepare(
    `SELECT chunk_index, page, content
     FROM chunks
     WHERE chat_id = ? AND document_id = ?
     ORDER BY chunk_index ASC
     LIMIT ?`
  ).bind(String(chatId), Number(documentId), Number(limit)).all();

  return rows.results || [];
}

async function getChunkPreviewRangeForDocument(env, chatId, documentId, startIndex, limit = 3) {
  const rows = await env.DB.prepare(
    `SELECT chunk_index, page, content
     FROM chunks
     WHERE chat_id = ? AND document_id = ? AND chunk_index >= ?
     ORDER BY chunk_index ASC
     LIMIT ?`
  ).bind(String(chatId), Number(documentId), Number(startIndex), Number(limit)).all();

  return rows.results || [];
}

async function getChunkPreviewTailForDocument(env, chatId, documentId, limit = 3) {
  const rows = await env.DB.prepare(
    `SELECT chunk_index, page, content
     FROM chunks
     WHERE chat_id = ? AND document_id = ?
     ORDER BY chunk_index DESC
     LIMIT ?`
  ).bind(String(chatId), Number(documentId), Number(limit)).all();

  return (rows.results || []).sort((a, b) => a.chunk_index - b.chunk_index);
}

async function clearChatData(env, chatId) {
  await env.DB.prepare(`DELETE FROM chunks WHERE chat_id = ?`).bind(String(chatId)).run();
  await env.DB.prepare(`DELETE FROM documents WHERE chat_id = ?`).bind(String(chatId)).run();
  await env.DB.prepare(`DELETE FROM messages WHERE chat_id = ?`).bind(String(chatId)).run();
}

async function enqueueDocumentForProcessing(env, docRow) {
  await env.PDF_QUEUE.send({
    chat_id: String(docRow.chat_id),
    document_id: Number(docRow.id),
    file_id: docRow.telegram_file_id,
    file_name: docRow.file_name || "document.pdf",
    mime_type: docRow.mime_type || "application/pdf"
  });
}

async function handleDocumentMessage(message, env) {
  const chatId = message.chat?.id;
  const doc = message.document;
  if (!chatId || !doc) return;

  try {
    if (doc.mime_type !== "application/pdf") {
      await sendTelegramMessage(env, chatId, "Por ahora solo puedo procesar PDFs.");
      return;
    }

    await sendTelegramMessage(
      env,
      chatId,
      `📥 Recibí el PDF: ${doc.file_name || "document.pdf"}.\nLo pondré en cola para procesarlo.`
    );

    const documentId = await saveDocument(env, chatId, doc);

    await env.PDF_QUEUE.send({
      chat_id: String(chatId),
      document_id: Number(documentId),
      file_id: doc.file_id,
      file_name: doc.file_name || "document.pdf",
      mime_type: doc.mime_type || "application/pdf"
    });

    await sendTelegramMessage(
      env,
      chatId,
      `🕓 PDF enviado a cola.\nID documento: ${documentId}`
    );
  } catch (err) {
    console.error("handleDocumentMessage error:", err?.stack || err?.message || String(err));
    await sendTelegramMessage(env, chatId, `⚠️ Falló el registro del PDF.\n${safeErrorMessage(err)}`);
  }
}

async function handleDocListCommand(env, chatId) {
  const docs = await getDocumentsForChat(env, chatId, 10);

  if (!docs.length) {
    await sendTelegramMessage(env, chatId, "No hay documentos registrados en este chat.");
    return;
  }

  const lines = docs.map((d) => [
    `#${d.id} ${d.file_name || "document.pdf"}`,
    `estado=${d.status || "sin_status"} | intentos=${d.attempts || 0} | chunks=${d.chunk_count || 0}`,
    d.updated_at ? `actualizado=${d.updated_at}` : null
  ].filter(Boolean).join("\n"));

  await sendTelegramLongMessage(env, chatId, `📄 Documentos recientes\n\n${lines.join("\n\n")}`);
}

async function handleDocErrorsCommand(env, chatId) {
  const docs = await getErroredDocumentsForChat(env, chatId, 10);

  if (!docs.length) {
    await sendTelegramMessage(env, chatId, "No hay documentos con error registrados en este chat.");
    return;
  }

  const lines = docs.map((d) => {
    const err = (d.last_error || "Sin detalle").slice(0, 250);
    return [
      `#${d.id} ${d.file_name || "document.pdf"}`,
      `estado=${d.status || "sin_status"} | intentos=${d.attempts || 0}`,
      `error=${err}`
    ].join("\n");
  });

  await sendTelegramLongMessage(env, chatId, `⚠️ Documentos con error\n\n${lines.join("\n\n")}`);
}

async function handleDocPreviewCommand(env, chatId, text) {
  const match = text.match(/^\/doc_preview\s+(\d+)$/i);
  if (!match) {
    await sendTelegramMessage(env, chatId, "Uso: /doc_preview <id_documento>");
    return;
  }

  const documentId = Number(match[1]);
  const doc = await getDocumentByIdForChat(env, chatId, documentId);

  if (!doc) {
    await sendTelegramMessage(env, chatId, `No encontré el documento #${documentId} en este chat.`);
    return;
  }

  const chunks = await getChunkPreviewForDocument(env, chatId, documentId, 3);
  if (!chunks.length) {
    await sendTelegramMessage(env, chatId, `El documento #${documentId} no tiene chunks guardados.`);
    return;
  }

  const preview = chunks.map((c) => {
    const content = String(c.content || "").slice(0, 350);
    return `#chunk ${c.chunk_index}${Number(c.page) > 0 ? ` (pág. ${c.page})` : ""}\n${content}`;
  }).join("\n\n---\n\n");

  await sendTelegramLongMessage(env, chatId, `👀 Vista previa de #${documentId} ${doc.file_name || "document.pdf"}\n\n${preview}`);
}

async function handleDocPreviewRangeCommand(env, chatId, text) {
  const match = text.match(/^\/doc_preview_range\s+(\d+)\s+(\d+)\s+(\d+)$/i);
  if (!match) {
    await sendTelegramMessage(env, chatId, "Uso: /doc_preview_range <id_documento> <inicio_chunk> <cantidad>");
    return;
  }

  const documentId = Number(match[1]);
  const startIndex = Number(match[2]);
  const count = Math.min(Number(match[3]), 3);
  const doc = await getDocumentByIdForChat(env, chatId, documentId);

  if (!doc) {
    await sendTelegramMessage(env, chatId, `No encontré el documento #${documentId} en este chat.`);
    return;
  }

  const chunks = await getChunkPreviewRangeForDocument(env, chatId, documentId, startIndex, count);
  if (!chunks.length) {
    await sendTelegramMessage(env, chatId, `No encontré chunks desde el índice ${startIndex} para el documento #${documentId}.`);
    return;
  }

  const preview = chunks.map((c) => {
    const content = String(c.content || "").slice(0, 350);
    return `#chunk ${c.chunk_index}${Number(c.page) > 0 ? ` (pág. ${c.page})` : ""}\n${content}`;
  }).join("\n\n---\n\n");

  await sendTelegramLongMessage(env, chatId, `👀 Vista previa de rango para #${documentId} ${doc.file_name || "document.pdf"}\n\n${preview}`);
}

async function handleDocPreviewTailCommand(env, chatId, text) {
  const match = text.match(/^\/doc_preview_tail\s+(\d+)(?:\s+(\d+))?$/i);
  if (!match) {
    await sendTelegramMessage(env, chatId, "Uso: /doc_preview_tail <id_documento> <cantidad_opcional>");
    return;
  }

  const documentId = Number(match[1]);
  const count = Math.min(Number(match[2] || 3), 3);
  const doc = await getDocumentByIdForChat(env, chatId, documentId);

  if (!doc) {
    await sendTelegramMessage(env, chatId, `No encontré el documento #${documentId} en este chat.`);
    return;
  }

  const chunks = await getChunkPreviewTailForDocument(env, chatId, documentId, count);
  if (!chunks.length) {
    await sendTelegramMessage(env, chatId, `El documento #${documentId} no tiene chunks guardados.`);
    return;
  }

  const preview = chunks.map((c) => {
    const content = String(c.content || "").slice(0, 350);
    return `#chunk ${c.chunk_index}${Number(c.page) > 0 ? ` (pág. ${c.page})` : ""}\n${content}`;
  }).join("\n\n---\n\n");

  await sendTelegramLongMessage(env, chatId, `👀 Vista previa final de #${documentId} ${doc.file_name || "document.pdf"}\n\n${preview}`);
}

async function handleDocSearchCommand(env, chatId, text) {
  const match = text.match(/^\/doc_search\s+(\d+)\s+(.+)$/i);
  if (!match) {
    await sendTelegramMessage(env, chatId, "Uso: /doc_search <id_documento> <término>");
    return;
  }

  const documentId = Number(match[1]);
  const term = String(match[2] || "").trim();
  const doc = await getDocumentByIdForChat(env, chatId, documentId);

  if (!doc) {
    await sendTelegramMessage(env, chatId, `No encontré el documento #${documentId} en este chat.`);
    return;
  }

  const results = await searchChunksByTerm(env, chatId, documentId, term, 8);
  if (!results.length) {
    await sendTelegramMessage(env, chatId, `No encontré coincidencias para "${term}" en el documento #${documentId}.`);
    return;
  }

  const lines = results.map((r) => {
    const content = String(r.content || "").slice(0, 220);
    return `#chunk ${r.chunk_index}${Number(r.page) > 0 ? ` (pág. ${r.page})` : ""} | score=${r.score.toFixed(2)}\n${content}`;
  }).join("\n\n---\n\n");

  await sendTelegramMessage(
    env,
    chatId,
    `🔎 Resultados de búsqueda en #${documentId} ${doc.file_name || "document.pdf"}\nConsulta: ${term}\n\n${lines}`
  );
}

async function handleAskDocCommand(env, chatId, text) {
  const match = text.match(/^\/ask_doc\s+(\d+)\s+([\s\S]+)$/i);

  if (!match) {
    await sendTelegramMessage(env, chatId, "Uso: /ask_doc <id_documento> <pregunta>");
    return;
  }

  const documentId = Number(match[1]);
  const question = String(match[2] || "").trim();
  const doc = await getDocumentByIdForChat(env, chatId, documentId);

  if (!doc) {
    await sendTelegramMessage(env, chatId, `No encontré el documento #${documentId} en este chat.`);
    return;
  }

  try {
    await sendTelegramMessage(env, chatId, `Consultando directamente el PDF #${documentId}: ${doc.file_name || "document.pdf"}`);

    const tgFile = await telegramGetFile(env, doc.telegram_file_id);
    const fileBytes = await telegramDownloadFile(env, tgFile.file_path);

    const answer = await askPdfDirect(
      env,
      fileBytes,
      doc.file_name || "document.pdf",
      doc.mime_type || "application/pdf",
      question
    );

    await sendTelegramLongMessage(env, chatId, answer);
  } catch (err) {
    console.error("handleAskDocCommand error:", err?.stack || err?.message || String(err));
    await sendTelegramMessage(
      env,
      chatId,
      `⚠️ No pude consultar directamente el PDF #${documentId}.\n${safeErrorMessage(err)}`
    );
  }
}

async function handleReindexCommand(env, chatId, text) {
  const match = text.match(/^\/reindex\s+(\d+)$/i);
  if (!match) {
    await sendTelegramMessage(env, chatId, "Uso: /reindex <id_documento>");
    return;
  }

  const documentId = Number(match[1]);
  const doc = await getDocumentByIdForChat(env, chatId, documentId);

  if (!doc) {
    await sendTelegramMessage(env, chatId, `No encontré el documento #${documentId} en este chat.`);
    return;
  }

  await clearChunksForDocument(env, documentId);
  await resetDocumentForReindex(env, documentId);
  await enqueueDocumentForProcessing(env, doc);

  await sendTelegramMessage(env, chatId, `♻️ Reindexación programada para #${doc.id} ${doc.file_name || "document.pdf"}`);
}

async function handleDeleteDocCommand(env, chatId, text) {
  const match = text.match(/^\/delete_doc\s+(\d+)$/i);
  if (!match) {
    await sendTelegramMessage(env, chatId, "Uso: /delete_doc <id_documento>");
    return;
  }

  const documentId = Number(match[1]);
  const doc = await getDocumentByIdForChat(env, chatId, documentId);

  if (!doc) {
    await sendTelegramMessage(env, chatId, `No encontré el documento #${documentId} en este chat.`);
    return;
  }

  await clearChunksForDocument(env, documentId);
  await env.DB.prepare(`DELETE FROM documents WHERE id = ? AND chat_id = ?`)
    .bind(documentId, String(chatId)).run();

  await sendTelegramMessage(
    env,
    chatId,
    `🗑️ Eliminé el documento #${doc.id} ${doc.file_name || ""} y sus chunks. Usa /kb_status para verificar.`
  );
}


async function handleTextMessage(message, env) {
  const chatId = message.chat?.id;
  const text = message.text || "";
  if (!chatId || !text) return;

  try {
    if (text === "/start") {
      await sendTelegramMessage(env, chatId, "Hola 👋 Soy un bot técnico de soldadura. También puedes enviarme PDFs para usarlos como base de conocimiento.");
      return;
    }

    if (text === "/reset") {
      await clearChatData(env, chatId);
      await sendTelegramMessage(env, chatId, "Listo ✅ Reinicié el contexto y borré documentos/chunks de este chat.");
      return;
    }

    if (text === "/kb_status") {
      const docs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM documents WHERE chat_id = ?`).bind(String(chatId)).first();
      const chunks = await env.DB.prepare(`SELECT COUNT(*) AS n FROM chunks WHERE chat_id = ?`).bind(String(chatId)).first();
      const statusRows = await env.DB.prepare(
        `SELECT status, COUNT(*) AS n
         FROM documents
         WHERE chat_id = ?
         GROUP BY status`
      ).bind(String(chatId)).all();

      const statusText = (statusRows.results || []).map((r) => `- ${r.status || "sin_status"}: ${r.n}`).join("\n");

      await sendTelegramMessage(
        env,
        chatId,
        `📚 Base de conocimiento\nPDFs: ${docs?.n || 0}\nChunks: ${chunks?.n || 0}${statusText ? `\n${statusText}` : ""}`
      );
      return;
    }

    if (text === "/doc_list") return await handleDocListCommand(env, chatId);
    if (text === "/doc_errors") return await handleDocErrorsCommand(env, chatId);
    if (/^\/doc_preview_tail\b/i.test(text)) return await handleDocPreviewTailCommand(env, chatId, text);
    if (/^\/doc_preview_range\b/i.test(text)) return await handleDocPreviewRangeCommand(env, chatId, text);
    if (/^\/doc_preview\b/i.test(text)) return await handleDocPreviewCommand(env, chatId, text);
    if (/^\/doc_search\b/i.test(text)) return await handleDocSearchCommand(env, chatId, text);
    if (/^\/ask_doc\b/i.test(text)) return await handleAskDocCommand(env, chatId, text);
    if (/^\/delete_doc\b/i.test(text)) return await handleDeleteDocCommand(env, chatId, text);
    if (/^\/reindex\b/i.test(text)) return await handleReindexCommand(env, chatId, text);

    const { intent } = classifyIntent(text);

    if (intent === "EMERGENCIA") {
      await sendTelegramLongMessage(env, chatId, emergencyResponse());
      return;
    }

    if (isSourceQuestion(text)) {
      await saveMessage(env, chatId, "user", text, intent);
      const lastAssistant = await getLastAssistantMessageMeta(env, chatId);
      const sourceAnswer = buildSourceAnswerFromMeta(lastAssistant);
      await saveMessage(env, chatId, "assistant", sourceAnswer, {
        intent,
        source: "source_lookup",
        fileName: lastAssistant?.meta?.fileName || null,
        query: lastAssistant?.meta?.query || null,
        sources: lastAssistant?.meta?.sources || []
      });
      await sendTelegramLongMessage(env, chatId, sourceAnswer);
      return;
    }

    const previousUserText = await getPreviousUsefulUserMessage(env, chatId);
    const expandedText = expandFollowUpQuestion(text, previousUserText);
    const hasFollowUpExpansion = expandedText.trim() !== text.trim();

    await saveMessage(env, chatId, "user", text, intent);

    const completedDocs = await getCompletedDocumentsForChat(env, chatId, 25);
    const hasCompletedDocs = completedDocs.length > 0;

    const retrievalQuery = expandedText || text;
    const topChunks = await getTopChunksSemantic(env, chatId, retrievalQuery, 10);
    const contextText = truncateText(
      topChunks.map((c) =>
        `[DOC:${c.source_name} | pág:${Number.isFinite(Number(c.page)) && Number(c.page) > 0 ? Number(c.page) : "?"} | doc_id:${c.document_id} | score:${c.score.toFixed(2)} | sem:${c.semanticScore.toFixed(3)} | kw:${c.keywordScore.toFixed(2)} | sec:${c.sectionScore.toFixed(2)} | phr:${c.phraseScore.toFixed(2)}] ${c.content}`
      ).join("\n\n"),
      14000
    );

    const retrieval = computeRetrievalStrength(topChunks);
    console.log("retrieval summary:", JSON.stringify({
      chatId: String(chatId),
      query: retrievalQuery,
      topScore: retrieval.topScore,
      topSemantic: retrieval.topSemantic,
      coverage: retrieval.coverage,
      docCount: retrieval.docCount,
      chunks: topChunks.length
    }));

    const conversationText = await getRecentConversation(env, chatId, 6);

    let answer = "";
    let directAnswer = "";
    let answerSource = "generic";
    let chosenDoc = null;
    let geminiQuotaExhausted = false;
    let geminiAnswered = false;
    const docSummary = summarizeTopDocuments(topChunks, 3);
    const explicitDocMode = isExplicitDocumentQuestion(retrievalQuery);
    let singleDocMode = explicitDocMode;

    try {
      console.log("callGeminiAnswer.start");
      answer = await callGeminiAnswer(env, retrievalQuery, intent, contextText, conversationText);
      answerSource = "rag";
      geminiAnswered = !!(answer && answer.trim());
      console.log("callGeminiAnswer.ok", JSON.stringify({ len: answer?.length || 0 }));
    } catch (err) {
      geminiQuotaExhausted = isQuotaExceededError(err);
      console.error("callGeminiAnswer.error:", err?.stack || err?.message || String(err));
      if (geminiQuotaExhausted) {
        console.log("gemini_quota_exhausted", JSON.stringify({ stage: "callGeminiAnswer" }));
      }
    }

    const shouldDirectFallback = !geminiQuotaExhausted && singleDocMode && shouldFallbackToDirectDoc(retrievalQuery, answer || "", topChunks, hasCompletedDocs);

    if (hasCompletedDocs) {
      try {
        chosenDoc = await chooseBestDocumentForQuestion(env, chatId, retrievalQuery, topChunks);
        singleDocMode = shouldUseSingleDocumentMode(retrievalQuery, topChunks, chosenDoc);
        console.log("document_choice", JSON.stringify({
          chosen_document_id: singleDocMode ? (chosenDoc?.id || null) : null,
          chosen_file_name: singleDocMode ? (chosenDoc?.file_name || null) : null,
          mode: singleDocMode ? "single_doc" : "multi_doc",
          candidates: docSummary.map((d) => ({ document_id: d.document_id, file_name: d.file_name, score: Number(d.score || 0).toFixed(2), chunk_count: d.chunk_count }))
        }));
        if (!singleDocMode) {
          chosenDoc = null;
        }
      } catch (err) {
        console.error("document_choice.error:", err?.stack || err?.message || String(err));
      }
    }

    if (hasCompletedDocs && shouldDirectFallback) {
      try {
        console.log("direct_doc_fallback.start", JSON.stringify({
          chosen_document_id: chosenDoc?.id || null,
          chosen_file_name: chosenDoc?.file_name || null,
          reason: {
            explicitDoc: isExplicitDocumentQuestion(retrievalQuery),
            shortThematic: isShortThematicQuestion(retrievalQuery),
            weakAnswer: isWeakAnswerText(answer || "") || !answerHasEnoughEvidence(retrievalQuery, answer || ""),
            retrievalWeak: retrieval.weak,
            geminiQuotaExhausted
          }
        }));

        if (chosenDoc?.telegram_file_id) {
          const tgFile = await telegramGetFile(env, chosenDoc.telegram_file_id);
          const fileBytes = await telegramDownloadFile(env, tgFile.file_path);

          directAnswer = await askPdfDirect(
            env,
            fileBytes,
            chosenDoc.file_name || "document.pdf",
            chosenDoc.mime_type || "application/pdf",
            retrievalQuery
          );

          if (directAnswer && directAnswer.trim()) {
            answer = directAnswer;
            answerSource = "direct_pdf";
          }

          console.log("direct_doc_fallback.ok", JSON.stringify({
            chosen_document_id: chosenDoc?.id || null,
            len: directAnswer?.length || 0
          }));
        }
      } catch (err) {
        if (isQuotaExceededError(err)) {
          geminiQuotaExhausted = true;
          console.log("gemini_quota_exhausted", JSON.stringify({ stage: "direct_doc_fallback" }));
        }
        console.error("direct_doc_fallback.error:", err?.stack || err?.message || String(err));
      }
    }

    if ((!answer || isWeakAnswerText(answer)) && hasCompletedDocs && singleDocMode && !directAnswer && !geminiQuotaExhausted) {
      try {
        if (chosenDoc?.telegram_file_id) {
          console.log("direct_doc_recovery.start", JSON.stringify({ chosen_document_id: chosenDoc.id, chosen_file_name: chosenDoc.file_name }));
          const tgFile = await telegramGetFile(env, chosenDoc.telegram_file_id);
          const fileBytes = await telegramDownloadFile(env, tgFile.file_path);

          directAnswer = await askPdfDirect(
            env,
            fileBytes,
            chosenDoc.file_name || "document.pdf",
            chosenDoc.mime_type || "application/pdf",
            retrievalQuery
          );

          if (directAnswer && directAnswer.trim() && !isWeakAnswerText(directAnswer)) {
            answer = directAnswer;
            answerSource = "direct_pdf_recovery";
          }
          console.log("direct_doc_recovery.ok", JSON.stringify({ len: directAnswer?.length || 0 }));
        }
      } catch (err) {
        if (isQuotaExceededError(err)) {
          geminiQuotaExhausted = true;
          console.log("gemini_quota_exhausted", JSON.stringify({ stage: "direct_doc_recovery" }));
        }
        console.error("direct_doc_recovery.error:", err?.stack || err?.message || String(err));
      }
    }

    // Solo caemos al índice local si Gemini NO entregó una respuesta usable.
    // Una respuesta sustantiva de Gemini ya no se descarta por el umbral frágil
    // de "evidencia" (que rechazaba buenas respuestas por décimas de cobertura);
    // si está vacía o es un claro "no puedo responder", entonces sí usamos el local.
    const geminiAnswerUsable = !!(answer && answer.trim()) && !isWeakAnswerText(answer);

    if (hasCompletedDocs && !directAnswer && !geminiAnswerUsable) {
      const geminiUnavailable = geminiQuotaExhausted || !geminiAnswered;
      if (singleDocMode) {
        answer = buildLocalChunkAnswer(retrievalQuery, topChunks, chosenDoc, {
          preferredDocumentId: chosenDoc?.id || null,
          geminiUnavailable,
        });
        answerSource = geminiQuotaExhausted ? "local_chunks_quota" : "local_chunks";
      } else {
        answer = buildMultiDocumentLocalAnswer(retrievalQuery, topChunks, {
          documents: docSummary,
          geminiUnavailable,
        });
        answerSource = geminiQuotaExhausted ? "local_chunks_multi_quota" : "local_chunks_multi";
      }
    }

    if (!answer) {
      answer = baseResponse(intent);
      answerSource = "base_response";
    }

    const finalAnswer = hasFollowUpExpansion && answerSource !== "base_response"
      ? `Consulta interpretada: ${expandedText}

${answer}`
      : answer;

    const sourceRefs = singleDocMode
      ? formatChunkSources((topChunks || []).filter((c) => Number(c.document_id || 0) === Number(chosenDoc?.id || 0)).slice(0, 3)).split(/,\s*/).filter(Boolean)
      : docSummary.flatMap((d) => d.chunk_refs).slice(0, 6);

    await saveMessage(env, chatId, "assistant", finalAnswer || "", {
      intent,
      source: answerSource,
      docId: chosenDoc?.id || null,
      fileName: chosenDoc?.file_name || null,
      query: retrievalQuery,
      sources: sourceRefs,
      documents: docSummary
    });

    console.log("telegram_final_send.start", JSON.stringify({
      source: answerSource,
      len: finalAnswer?.length || 0,
      chosen_document_id: chosenDoc?.id || null,
      chosen_file_name: chosenDoc?.file_name || null
    }));

    try {
      await sendTelegramLongMessage(env, chatId, finalAnswer || "");
      console.log("telegram_final_send.ok");
    } catch (err) {
      console.error("telegram_final_send.error:", err?.stack || err?.message || String(err));
      throw err;
    }
  } catch (err) {
    console.error("handleTextMessage error:", err?.stack || err?.message || String(err));
    await sendTelegramMessage(env, chatId, "⚠️ Ocurrió un error procesando tu mensaje. Revisa logs del Worker.");
  }
}


async function handleTelegramUpdate(update, env) {
  console.log("UPDATE:", JSON.stringify(update));

  const message = update?.message;
  if (!message) return;

  if (message.document) {
    console.log("Documento recibido:", message.document.file_name, message.document.mime_type);
    await handleDocumentMessage(message, env);
    return;
  }

  if (message.text) {
    console.log("Texto recibido:", message.text);
    await handleTextMessage(message, env);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "telegram-welding-worker" });
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      if (env.WEBHOOK_SECRET) {
        const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (incomingSecret !== env.WEBHOOK_SECRET) {
          return jsonResponse({ ok: false, error: "unauthorized_webhook" }, 401);
        }
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "invalid_json" }, 400);
      }

      ctx.waitUntil(
        handleTelegramUpdate(update, env).catch((err) => {
          console.error("handleTelegramUpdate error:", err?.stack || err?.message || String(err));
        })
      );

      return new Response("OK", { status: 200 });
    }

    if (request.method === "POST" && url.pathname === "/admin/set-webhook") {
      const adminSecret = request.headers.get("x-admin-secret");
      if (!env.ADMIN_SECRET || adminSecret !== env.ADMIN_SECRET) {
        return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      }

      const webhookUrl = `${url.origin}/webhook`;
      const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: env.WEBHOOK_SECRET
        })
      });

      const data = await resp.json();
      return jsonResponse(data, resp.ok ? 200 : 500);
    }

    return jsonResponse({ ok: false, error: "not_found" }, 404);
  },

  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      const job = message.body || {};
      const chatId = String(job.chat_id || "");
      const documentId = Number(job.document_id || 0);
      const fileId = job.file_id;
      const fileName = job.file_name || "document.pdf";
      const mimeType = job.mime_type || "application/pdf";
      const attempts = Number(message.attempts || 1);

      try {
        console.log("Queue message received:", JSON.stringify(job), "attempt:", attempts);
        await markDocumentProcessingAttempt(env, documentId);

        if (attempts <= 1) {
          try {
            await sendTelegramMessage(env, chatId, `⚙️ Procesando PDF en cola: ${fileName}`);
          } catch {}
        }

        const tgFile = await telegramGetFile(env, fileId);
        const fileBytes = await telegramDownloadFile(env, tgFile.file_path);
        console.log("Queue PDF descargado, bytes:", fileBytes.byteLength);

        if (attempts <= 1) {
          try {
            await sendTelegramMessage(env, chatId, `📤 Subiendo PDF a Gemini Files API: ${fileName}`);
          } catch {}
        }

        const extractedText = await extractPdfText(env, fileBytes, fileName, mimeType);
        console.log("Extraction length raw:", extractedText?.length || 0);

        const cleanedText = cleanExtractedText(extractedText);
        console.log("Extraction length cleaned:", cleanedText?.length || 0);

        if (!cleanedText || cleanedText.trim().length < 50) {
          const errMsg = `No pude extraer suficiente texto útil del PDF: ${fileName}`;
          await updateDocumentStatus(env, documentId, "failed", errMsg);
          try {
            await sendTelegramMessage(env, chatId, `⚠️ ${errMsg}`);
          } catch {}
          message.ack();
          continue;
        }

        const chunks = splitIntoPageChunks(extractedText, 1200, 150).filter((pc) => isUsefulChunk(pc.content));
        console.log("Queue chunks útiles generados:", chunks.length);

        if (!chunks.length) {
          const errMsg = `No se generaron chunks útiles para el PDF: ${fileName}`;
          await updateDocumentStatus(env, documentId, "failed", errMsg);
          try {
            await sendTelegramMessage(env, chatId, `⚠️ ${errMsg}`);
          } catch {}
          message.ack();
          continue;
        }

        if (attempts <= 1) {
          try {
            await sendTelegramMessage(env, chatId, `🧠 Generando embeddings e indexando: ${fileName}`);
          } catch {}
        }

        await clearChunksForDocument(env, documentId);
        await saveChunks(env, chatId, documentId, fileName, chunks);
        await updateDocumentStatus(env, documentId, "completed", null);

        try {
          await sendTelegramMessage(
            env,
            chatId,
            `✅ PDF indexado correctamente.\nModo extracción: gemini_files_api\nChunks guardados: ${chunks.length}`
          );
        } catch {}

        message.ack();
      } catch (err) {
        const errMsg = safeErrorMessage(err);
        console.error("Queue consumer error:", err?.stack || err?.message || String(err));

        try {
          await updateDocumentStatus(env, documentId, "failed", errMsg);
        } catch {}

        const shouldRetry = isRetryableError(err) && attempts < 2;

        try {
          if (chatId) {
            if (shouldRetry) {
              await sendTelegramMessage(
                env,
                chatId,
                `⏳ El procesamiento del PDF falló temporalmente.\nSe reintentará una vez más: ${fileName}`
              );
            } else {
              await sendTelegramMessage(
                env,
                chatId,
                `⚠️ Error procesando PDF: ${fileName}\n${errMsg}`
              );
            }
          }
        } catch {}

        if (shouldRetry) {
          message.retry({ delaySeconds: queueRetryDelaySeconds(attempts) });
        } else {
          message.ack();
        }
      }
    }
  }
};
// ===========================================================================
// Export SOLO para pruebas locales (arnés Node). No afecta al Worker:
// Cloudflare/Wrangler únicamente usa el "export default" de arriba.
// ===========================================================================
export const __test__ = {
  classifyIntent,
  splitIntoChunks,
  splitIntoPageChunks,
  chunkSourceLabel,
  formatChunkSources,
  isUsefulChunk,
  cleanExtractedText,
  cosineSimilarity,
  tokenize,
  extractSectionRefs,
  keywordScoreDetailed,
  phraseScore,
  sectionMatchScore,
  importantTermBoost,
  isFollowUpQuestion,
  expandFollowUpQuestion,
  isExplicitDocumentQuestion,
  isShortThematicQuestion,
  isWeakAnswerText,
  answerHasEnoughEvidence,
  buildLocalChunkAnswer,
  buildMultiDocumentLocalAnswer,
  computeRetrievalStrength,
  scoreSentenceForQuestion,
  sentenceEvidenceStats,
  backoffMs,
  queueRetryDelaySeconds,
  retryAfterMs,
  splitTelegramText,
  sanitizeTelegramText,
};

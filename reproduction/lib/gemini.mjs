// Llamadas a la API de Gemini usadas por el paquete de reproducción.
// Mismos modelos y parámetros que el chatbot v15 (src/index.js):
//   generación  gemini-2.5-flash, temperature 0.2, maxOutputTokens 1400, thinkingBudget 0
//   embeddings  gemini-embedding-001 (sin taskType, dimensión por defecto)
// Cada llamada devuelve también usageMetadata y la latencia, para el análisis de costo (R1).

export const ANSWER_MODEL = process.env.GEMINI_ANSWER_MODEL || "gemini-2.5-flash";
export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
export const GEN_CONFIG = {
  temperature: 0.2,
  maxOutputTokens: 1400,
  thinkingConfig: { thinkingBudget: 0 },
};

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("Define GEMINI_API_KEY en el entorno.");
  return k;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, body, { retries = 5, label = "gemini" } = {}) {
  let wait = 2000;
  for (let attempt = 0; ; attempt++) {
    let resp, text;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey() },
        body: JSON.stringify(body),
      });
      text = await resp.text();
    } catch (err) {
      if (attempt < retries) { await sleep(wait); wait = Math.min(wait * 2, 30000); continue; }
      throw new Error(`${label}: ${err.message}`);
    }
    if (resp.ok) return JSON.parse(text);
    if ([429, 500, 502, 503, 504].includes(resp.status) && attempt < retries) {
      console.warn(`  ${label}: HTTP ${resp.status}, reintento en ${wait / 1000}s`);
      await sleep(wait); wait = Math.min(wait * 2, 30000); continue;
    }
    throw new Error(`${label}: HTTP ${resp.status} ${text.slice(0, 400)}`);
  }
}

export async function embed(text) {
  const data = await postJson(`${BASE}/${EMBEDDING_MODEL}:embedContent`, {
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
  }, { label: "embed" });
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || !values.length) throw new Error("Embedding vacío");
  return values;
}

export async function embedBatch(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const slice = texts.slice(i, i + 100);
    const data = await postJson(`${BASE}/${EMBEDDING_MODEL}:batchEmbedContents`, {
      requests: slice.map((t) => ({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text: t }] } })),
    }, { label: `embed x${slice.length}` });
    for (const e of data.embeddings || []) out.push(e.values);
    process.stdout.write(`  embeddings ${out.length}/${texts.length}\r`);
  }
  process.stdout.write("\n");
  if (out.length !== texts.length) throw new Error("batchEmbedContents devolvió menos embeddings");
  return out;
}

// Cuenta tokens de un prompt sin generar (gratis). Útil para estimar el brazo LC.
export async function countTokens(promptText) {
  const data = await postJson(`${BASE}/${ANSWER_MODEL}:countTokens`, {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
  }, { label: "countTokens" });
  return data.totalTokens;
}

export async function generate(promptText, { genConfig = GEN_CONFIG, label = "generate" } = {}) {
  const t0 = performance.now();
  const data = await postJson(`${BASE}/${ANSWER_MODEL}:generateContent`, {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: genConfig,
  }, { label });
  const latency_ms = Math.round(performance.now() - t0);
  const cand = data?.candidates?.[0] || {};
  const text = (cand.content?.parts || []).map((p) => p?.text || "").join("").trim();
  return {
    text,
    finishReason: cand.finishReason || null,
    usage: data.usageMetadata || null,
    modelVersion: data.modelVersion || ANSWER_MODEL,
    latency_ms,
  };
}

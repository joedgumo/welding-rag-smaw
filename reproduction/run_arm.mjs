// run_arm.mjs — Genera respuestas de un brazo experimental con Gemini 2.5 Flash y registra
// tokens, latencia y pasajes usados.
//
//   --arm rag   réplica del v15: regla de emergencia + recuperación + prompt del v15
//   --arm lc    contexto largo: el MISMO prompt del v15, con el corpus completo como CONTEXTO
//   --arm base  sin recuperación: prompt de run_baseline.py (paquete IMRC)
//
// Opciones:
//   --tasks <json>     tareas ({"tareas":[{id, categoria, pregunta}]})
//   --out <json>       salida (además escribe <out>.txt con bloques "=== ID ===")
//   --count-only       solo cuenta los tokens del prompt (gratis) y termina
//   --no-emergency     (rag) desactiva la regla de palabras clave de emergencia del v15
//
// Ejemplos:
//   node run_arm.mjs --arm lc --tasks ../evaluation/original_study/tasks.json --count-only
//   node run_arm.mjs --arm lc --tasks ../evaluation/original_study/tasks.json --out out/lc_imrc.json
//   node run_arm.mjs --arm rag --tasks ../evaluation/original_study/tasks.json --out out/rag_replay_imrc.json
//   node run_arm.mjs --arm rag --tasks ../evaluation/revision/tasks_fuera_corpus_v2.json --out out/rag_fuera.json

import { readJsonl, readTasks, writeJson, writeBlocksTxt, loadCache, saveCache } from "./lib/io.mjs";
import { scoreChunks, buildRagContext, passagesInContext, buildLongContext, buildV15Prompt, buildBaselinePrompt, classifyIntent, citedPages } from "./lib/v15.mjs";
import { embed, generate, countTokens, ANSWER_MODEL, EMBEDDING_MODEL, GEN_CONFIG } from "./lib/gemini.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const arm = arg("--arm");
if (!["rag", "lc", "base"].includes(arm)) { console.error("--arm rag|lc|base"); process.exit(1); }
const tasks = readTasks(arg("--tasks"));
const outPath = arg("--out", `out/${arm}.json`);
const countOnly = has("--count-only");
const emergencyRule = !has("--no-emergency");

// Texto exacto de emergencyResponse() del v15 (index.js, línea 135).
const EMERGENCY = [
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

let rows = null, pages = null, longCtx = null;
if (arm === "rag") rows = readJsonl(arg("--chunks", "data/chunks.jsonl"));
if (arm === "lc") {
  pages = readJsonl(arg("--pages", "data/pages.jsonl"));
  longCtx = buildLongContext(pages);
  console.log(`Contexto largo: ${pages.length} páginas, ${longCtx.length.toLocaleString()} caracteres`);
}
const cachePath = process.env.QUERY_CACHE || "data/query_embeddings.json";
const cache = loadCache(cachePath);

const out = {
  meta: {
    fecha: new Date().toISOString(), brazo: arm, modelo: ANSWER_MODEL, generationConfig: GEN_CONFIG,
    embedding_model: arm === "rag" ? EMBEDDING_MODEL : null, regla_emergencia: arm === "rag" ? emergencyRule : null,
    historial: "(sin historial previo)", contexto_lc_caracteres: longCtx ? longCtx.length : null,
  },
  respuestas: [],
};

for (const t of tasks) {
  const q = t.pregunta;
  const { intent } = classifyIntent(q);
  const rec = { id: t.id, categoria: t.categoria, pregunta: q, intent };

  if (arm === "rag" && emergencyRule && intent === "EMERGENCIA") {
    Object.assign(rec, { ruta: "emergencia", respuesta: EMERGENCY, usage: null, latency_ms: 0, pasajes: [] });
    out.respuestas.push(rec); console.log(`[${t.id}] ruta emergencia (sin modelo)`); continue;
  }

  let prompt;
  if (arm === "rag") {
    if (!cache[q]) { cache[q] = await embed(q); saveCache(cachePath, cache); }
    const top = scoreChunks(q, cache[q], rows, 10);
    prompt = buildV15Prompt({ userText: q, intent, contextText: buildRagContext(top) });
    rec.ruta = "rag";
    rec.pasajes = top.map((c) => ({ chunk_id: c.id, source: c.source_name, page: c.page, score: +c.score.toFixed(3) }));
    rec.pasajes_en_contexto = passagesInContext(top);
    rec.query_embedding_tokens_aprox = Math.ceil(q.length / 4);
  } else if (arm === "lc") {
    prompt = buildV15Prompt({ userText: q, intent, contextText: longCtx });
    rec.ruta = "contexto_largo";
  } else {
    prompt = buildBaselinePrompt(q);
    rec.ruta = "sin_recuperacion";
  }
  rec.prompt_caracteres = prompt.length;

  if (countOnly) {
    rec.prompt_tokens = await countTokens(prompt);
    out.respuestas.push(rec);
    console.log(`[${t.id}] prompt = ${rec.prompt_tokens.toLocaleString()} tokens`);
    continue;
  }

  const g = await generate(prompt, { label: `${arm}:${t.id}` });
  Object.assign(rec, {
    respuesta: g.text, finishReason: g.finishReason, usage: g.usage, modelVersion: g.modelVersion,
    latency_ms: g.latency_ms, citas: citedPages(g.text),
  });
  out.respuestas.push(rec);
  console.log(`[${t.id}] ${g.usage?.promptTokenCount ?? "?"} in / ${g.usage?.candidatesTokenCount ?? "?"} out tokens, ${g.latency_ms} ms`);
  await new Promise((r) => setTimeout(r, 1000));
}

writeJson(outPath, out);
if (!countOnly) writeBlocksTxt(outPath.replace(/\.json$/, ".txt"), `Brazo ${arm} — ${ANSWER_MODEL} — ${out.meta.fecha}`, out.respuestas);
console.log(`-> ${outPath}`);

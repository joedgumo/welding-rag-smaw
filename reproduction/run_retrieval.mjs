// run_retrieval.mjs — Reproduce la recuperación del v15 para cada tarea y la registra (R2).
//
// Para cada pregunta: embedding de la consulta (en caché) -> puntuación híbrida del v15 sobre
// los pasajes -> 10 mejores pasajes (los que recibe el modelo). Si se da --compare con las
// respuestas originales, verifica la FIDELIDAD: ¿las páginas que citó el RAG en agosto están
// entre las páginas recuperadas ahora?
//
// Uso:
//   node run_retrieval.mjs --tasks ../evaluation/original_study/tasks.json \
//        --compare ../data/original_study/rag_responses.txt --out out/retrieval_imrc.json
//   node run_retrieval.mjs --tasks ../evaluation/revision/tasks_fuera_corpus_v2.json --out out/retrieval_fuera.json

import { readJsonl, readTasks, writeJson, readBlocksTxt, loadCache, saveCache } from "./lib/io.mjs";
import { scoreChunks, windowInfo, citedPages, classifyIntent, buildRagContext, passagesInContext } from "./lib/v15.mjs";
import { embed, EMBEDDING_MODEL } from "./lib/gemini.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const tasksPath = arg("--tasks");
const chunksPath = arg("--chunks", "data/chunks.jsonl");
const comparePath = arg("--compare", null);
const outPath = arg("--out", "out/retrieval.json");
const k = Number(arg("--k", 10));
const cachePath = process.env.QUERY_CACHE || "data/query_embeddings.json";

const tasks = readTasks(tasksPath);
const rows = readJsonl(chunksPath);
if (!rows[0]?.embedding) { console.error("chunks.jsonl no trae embeddings; corre ingest.mjs sin --no-embed o d1_to_jsonl.py"); process.exit(1); }
const original = comparePath ? readBlocksTxt(comparePath) : {};
const cache = loadCache(cachePath);

const out = { meta: { fecha: new Date().toISOString(), chunks: chunksPath, embedding_model: EMBEDDING_MODEL, k, ...windowInfo(rows) }, tareas: [] };

for (const t of tasks) {
  const q = t.pregunta;
  if (!cache[q]) { cache[q] = await embed(q); saveCache(cachePath, cache); }
  const top = scoreChunks(q, cache[q], rows, k);
  const ctx = buildRagContext(top);
  const truncated = ctx.endsWith("[contexto truncado]");
  const inContext = passagesInContext(top);
  const retrievedPages = top.map((c) => ({ source: c.source_name, page: c.page }));

  let fidelity = null;
  if (original[t.id] !== undefined) {
    const cited = citedPages(original[t.id]);
    const hit = cited.filter((c) => retrievedPages.some((r) => r.source === c.source && r.page === c.page));
    fidelity = { cited, cited_in_topk: hit.length, cited_total: cited.length };
  }

  out.tareas.push({
    id: t.id, categoria: t.categoria, pregunta: q, intent: classifyIntent(q).intent,
    contexto_truncado: truncated, pasajes_en_contexto: inContext,
    top: top.map((c, i) => ({
      rank: i + 1, chunk_id: c.id, source: c.source_name, page: c.page,
      score: +c.score.toFixed(3), sem: +c.semanticScore.toFixed(4), kw: +c.keywordScore.toFixed(2),
      sec: +c.sectionScore.toFixed(2), phr: +c.phraseScore.toFixed(2), preview: c.content.slice(0, 160),
    })),
    fidelidad: fidelity,
  });
  const f = fidelity ? `  citadas en top-${k}: ${fidelity.cited_in_topk}/${fidelity.cited_total}` : "";
  console.log(`[${t.id}] páginas: ${retrievedPages.map((r) => `${r.source.slice(4, 8)}:${r.page}`).join(" ")}${f}`);
}

writeJson(outPath, out);
console.log(`\nVentana de búsqueda: ${out.meta.searched} de ${out.meta.total_chunks} pasajes (LIMIT 600 ${out.meta.limit_600_binding ? "SÍ" : "no"} recorta).`);
console.log(`-> ${outPath}`);

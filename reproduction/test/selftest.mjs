// Prueba sin red ni llaves: simula la API de Gemini y corre los tres brazos de punta a punta
// sobre un corpus sintético. Uso:  npm test   (o  node test/selftest.mjs)
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "repro-"));
const vec = (s) => Array.from({ length: 16 }, (_, i) => Math.sin(i + s));
const chunks = [
  { id: 1, document_id: 1, source_name: "AWS_Z49.1-2012-SP.pdf", chunk_index: 0, page: 24, content: "Los factores para determinar una ventilación adecuada incluyen el volumen y configuración del espacio, la cantidad y tipo de operaciones, las concentraciones de contaminantes, el flujo de aire natural y la ubicación de las zonas de respiración.", embedding: vec(1) },
  { id: 2, document_id: 1, source_name: "AWS_Z49.1-2012-SP.pdf", chunk_index: 1, page: 30, content: "No se debe utilizar oxígeno, o cualquier otro gas o mezclas de gases, excepto aire, para ventilación de espacios confinados.", embedding: vec(2) },
  { id: 3, document_id: 2, source_name: "AWS_Tomo1_SMAW_cap1-2.pdf", chunk_index: 0, page: 58, content: "Las funciones principales de la cobertura del electrodo son estabilizar el arco y proteger el metal derretido de la atmósfera.", embedding: vec(3) },
];
writeFileSync(join(dir, "chunks.jsonl"), chunks.map((c) => JSON.stringify(c)).join("\n"));
writeFileSync(join(dir, "pages.jsonl"), chunks.map((c) => JSON.stringify({ source_name: c.source_name, page: c.page, text: c.content })).join("\n"));
writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tareas: [
  { id: "B1", categoria: "x", pregunta: "¿Cuáles son los factores para determinar una ventilación adecuada al soldar?" },
  { id: "C3", categoria: "x", pregunta: "¿Qué medidas de prevención y protección contra incendios deben tomarse antes de soldar?" },
] }));

process.env.GEMINI_API_KEY = "fake";
process.env.QUERY_CACHE = join(dir, "query_embeddings.json");  // nunca la caché real
let calls = 0;
globalThis.fetch = async (url, opts) => {
  calls++;
  const body = JSON.parse(opts.body);
  let out;
  if (url.includes(":embedContent")) out = { embedding: { values: vec(calls) } };
  else if (url.includes(":countTokens")) out = { totalTokens: Math.round(body.contents[0].parts[0].text.length / 4) };
  else out = { candidates: [{ content: { parts: [{ text: "Respuesta simulada.\n\nFuentes: AWS_Z49.1-2012-SP.pdf (pág. 24)" }] }, finishReason: "STOP" }],
               usageMetadata: { promptTokenCount: Math.round(body.contents[0].parts[0].text.length / 4), candidatesTokenCount: 300 } };
  return { ok: true, status: 200, text: async () => JSON.stringify(out) };
};

const run = async (args) => { process.argv = ["node", "x", ...args]; await import(new URL(`../${args[0]}?${Math.random()}`, import.meta.url)); };
const T = join(dir, "tasks.json");
await run(["run_retrieval.mjs", "--tasks", T, "--chunks", join(dir, "chunks.jsonl"), "--out", join(dir, "ret.json")]);
await run(["run_arm.mjs", "--arm", "rag", "--tasks", T, "--chunks", join(dir, "chunks.jsonl"), "--out", join(dir, "rag.json")]);
await run(["run_arm.mjs", "--arm", "lc", "--tasks", T, "--pages", join(dir, "pages.jsonl"), "--out", join(dir, "lc.json")]);
await run(["run_arm.mjs", "--arm", "base", "--tasks", T, "--out", join(dir, "base.json")]);

const rag = JSON.parse(readFileSync(join(dir, "rag.json"), "utf8")).respuestas;
const ok = rag.find((r) => r.id === "C3").ruta === "emergencia" && rag.find((r) => r.id === "B1").pasajes[0].page === 24;
console.log(ok ? `\nSELFTEST OK (${calls} llamadas simuladas)` : "\nSELFTEST FALLÓ");
process.exit(ok ? 0 : 1);

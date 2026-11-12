// ingest.mjs — Reconstruye el índice del chatbot v15 desde los PDFs, con su mismo código.
//
//   extracción  unpdf, página por página, con el marcador "==Start of OCR for page N=="
//               (igual que extractPdfText en modo EXTRACTION_MODE=unpdf)
//   troceo      splitIntoPageChunks(texto, 1200, 150) + filtro isUsefulChunk (v15)
//   embeddings  gemini-embedding-001 por lotes de 100 (opcional: --no-embed)
//
// Salidas en data/:
//   pages.jsonl   una línea por página: {source_name, page, text}  -> brazo de contexto largo
//   chunks.jsonl  una línea por pasaje: {id, document_id, source_name, chunk_index, page, content, embedding}
//
// Uso:
//   node ingest.mjs --pdf AWS_Z49.1-2012-SP.pdf --pdf AWS_Tomo1_SMAW_cap1-2.pdf
//   node ingest.mjs --pdf ... --no-embed      (solo páginas y pasajes, sin llamar a la API;
//                                             escribe data/chunks_sin_embeddings.jsonl)
//
// Si se exportó la base D1 original del estudio, preferir eval/d1_to_jsonl.py: usa los
// pasajes y embeddings exactos de agosto. Este script es la vía de reproducción pública.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { __test__ as T } from "../assistant/src/index.js";
import { embedBatch, EMBEDDING_MODEL } from "./lib/gemini.mjs";

const args = process.argv.slice(2);
const pdfs = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--pdf") pdfs.push(args[++i]);
const noEmbed = args.includes("--no-embed");
const oi = args.indexOf("--chunks-out");
// Con --no-embed no se toca data/chunks.jsonl (que puede venir de la exportación D1).
const chunksOut = oi > 0 ? args[oi + 1] : (noEmbed ? "data/chunks_sin_embeddings.jsonl" : "data/chunks.jsonl");
if (!pdfs.length) { console.error("Indica al menos un --pdf"); process.exit(1); }

const { extractText, getDocumentProxy } = await import("unpdf");
let unpdfVersion = "desconocida";
try { unpdfVersion = JSON.parse(readFileSync(new URL("./node_modules/unpdf/package.json", import.meta.url))).version; } catch {}

mkdirSync("data", { recursive: true });
const pageLines = [];
const chunkRows = [];
const docsMeta = [];
let nextId = 1;

for (const [di, path] of pdfs.entries()) {
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const name = basename(path);
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const result = await extractText(pdf, { mergePages: false });
  const pagesArr = Array.isArray(result?.text) ? result.text : [String(result?.text || "")];

  // Texto por página (para LC), limpiado igual que el troceo del v15.
  pagesArr.forEach((t, i) => {
    const clean = T.cleanExtractedText(String(t || "")).replace(/\s+/g, " ").trim();
    if (clean) pageLines.push({ source_name: name, page: i + 1, text: clean });
  });

  const marked = pagesArr.map((t, i) => `==Start of OCR for page ${i + 1}==\n${String(t || "")}`).join("\n\n").trim();
  const chunks = T.splitIntoPageChunks(marked, 1200, 150).filter((pc) => T.isUsefulChunk(pc.content));
  chunks.forEach((c, j) => chunkRows.push({
    id: nextId++, document_id: di + 1, source_name: name, chunk_index: j, page: c.page, content: c.content,
  }));
  docsMeta.push({ document_id: di + 1, file_name: name, sha256, pages: pagesArr.length, chunks: chunks.length });
  console.log(`${name}: ${pagesArr.length} páginas, ${chunks.length} pasajes`);
}

if (!noEmbed) {
  const embs = await embedBatch(chunkRows.map((c) => c.content));
  chunkRows.forEach((c, i) => { c.embedding = embs[i]; });
}

writeFileSync("data/pages.jsonl", pageLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
writeFileSync(chunksOut, chunkRows.map((l) => JSON.stringify(l)).join("\n") + "\n");
writeFileSync("data/index_meta.json", JSON.stringify({
  fecha: new Date().toISOString(), via: "ingest.mjs (PDF)", unpdf: unpdfVersion,
  embedding_model: noEmbed ? null : EMBEDDING_MODEL, chunkSize: 1200, overlap: 150,
  total_pages: pageLines.length, total_chunks: chunkRows.length, documentos: docsMeta,
}, null, 2));
console.log(`Listo: ${pageLines.length} páginas con texto, ${chunkRows.length} pasajes${noEmbed ? " (sin embeddings)" : ""}.`);

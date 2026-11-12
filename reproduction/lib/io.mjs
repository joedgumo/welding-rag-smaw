import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function readTasks(path) {
  const d = JSON.parse(readFileSync(path, "utf8"));
  return d.tareas || d;
}

export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

// Mismo formato que rag_responses.txt del paquete IMRC (bloques "=== ID ===").
export function writeBlocksTxt(path, header, items) {
  const body = items.map((r) => `=== ${r.id} ===\n${r.respuesta || ""}\n`).join("\n");
  writeFileSync(path, `# ${header}\n\n${body}`);
}

export function readBlocksTxt(path) {
  const out = {};
  let cur = null, buf = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^===\s*([A-Za-z0-9]+)\s*===\s*$/);
    if (m) { if (cur) out[cur] = buf.join("\n").trim(); cur = m[1].toUpperCase(); buf = []; }
    else if (cur && !line.trim().startsWith("#")) buf.push(line);
  }
  if (cur) out[cur] = buf.join("\n").trim();
  return out;
}

// Caché de embeddings de consultas: misma pregunta -> mismo vector en todas las corridas.
export function loadCache(path) { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; }
export function saveCache(path, c) { writeJson(path, c); }

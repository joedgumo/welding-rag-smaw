// ===========================================================================
// Arnés de pruebas locales — chatbot de soldadura (RAG)
// ---------------------------------------------------------------------------
// Prueba la LÓGICA PURA del Worker sin Cloudflare, sin Telegram y sin Gemini.
// No requiere llaves de API ni red. Ejecuta:   npm test    (o)  node test/harness.mjs
// ===========================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { __test__ as T } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "..", "src", "index.js");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  OK     ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FALLA  ${name}`);
  }
}

function group(title) {
  console.log(`\n— ${title} —`);
}

// ---------------------------------------------------------------------------
// 1) Regresión de configuración: que los bugs corregidos sigan corregidos.
// ---------------------------------------------------------------------------
group("Regresión de configuración (lee src/index.js)");
const src = readFileSync(SRC_PATH, "utf8");

check("Define function sleep", /function\s+sleep\s*\(/.test(src));
check("Define function backoffMs", /function\s+backoffMs\s*\(/.test(src));
check("Define function makeHttpError", /function\s+makeHttpError\s*\(/.test(src));
check("Define function queueRetryDelaySeconds", /function\s+queueRetryDelaySeconds\s*\(/.test(src));
check("Usa thinkingConfig en Gemini", /thinkingConfig/.test(src));
check("Desactiva thinking (thinkingBudget: 0)", /thinkingBudget:\s*0/.test(src));
check("Ya no quedan maxOutputTokens: 700 (que truncaban)", !/maxOutputTokens:\s*700\b/.test(src));
check("callGeminiAnswer recibe historial conversacional", /callGeminiAnswer\([^)]*conversationText/.test(src) || /conversationText\s*=\s*""/.test(src));

// Bug de bytes de retroceso (0x08) que rompía 6 comandos:
check("No quedan bytes de retroceso (0x08) corruptos en el código", !/\x08/.test(src));
check("Comando /doc_preview usa \\b correcto", /\/\^\\\/doc_preview\\b\/i/.test(src));
check("Comando /reindex usa \\b correcto", /\/\^\\\/reindex\\b\/i/.test(src));
check("Extracción por lotes de páginas (evita truncado y timeout 524)",
  /extractPdfPageRange/.test(src) && /extractPdfPageCount/.test(src));
check("Ya no hay extracción de una sola llamada a 32768 (que daba timeout)",
  !/maxOutputTokens:\s*32768\b/.test(src));
check("Recuperación directa solo reemplaza si no es respuesta débil",
  /!isWeakAnswerText\(directAnswer\)/.test(src));

// Optimizaciones de límites (subrequests + rate limit):
check("Usa embeddings por lote (batchEmbedContents)", /batchEmbedContents/.test(src));
check("Usa inserciones agrupadas (DB.batch)", /env\.DB\.batch\(/.test(src));
check("Reintenta los lotes de extracción que fallaron", /failedRanges/.test(src));
check("Honra el retry-after del 429", /retryAfterMs/.test(src));
check("Extracción local con unpdf + respaldo a Gemini", /import\("unpdf"\)/.test(src) && /extractPdfText\b/.test(src));
check("Comando /delete_doc registrado", /\/delete_doc\\b/.test(src) && /handleDeleteDocCommand/.test(src));
check("Modo de extracción configurable, por defecto 'gemini' (Camino B)",
  /EXTRACTION_MODE\s*\|\|\s*"gemini"/.test(src));

// retryAfterMs: parseo del tiempo de espera (tope corto de 12s)
const fakeResp = { headers: { get: () => null } };
check("retryAfterMs parsea 'retry in 5s' del cuerpo",
  T.retryAfterMs(fakeResp, "Please retry in 5s.", 0) >= 5000 &&
  T.retryAfterMs(fakeResp, "Please retry in 5s.", 0) <= 6000);
check("retryAfterMs respeta cabecera Retry-After",
  T.retryAfterMs({ headers: { get: (h) => (h === "retry-after" ? "5" : null) } }, "", 0) >= 5000 &&
  T.retryAfterMs({ headers: { get: (h) => (h === "retry-after" ? "5" : null) } }, "", 0) <= 6000);
check("retryAfterMs tiene tope de 12s",
  T.retryAfterMs(fakeResp, "Please retry in 999s.", 0) <= 12000);

// ---------------------------------------------------------------------------
// 2) Clasificación de intención
// ---------------------------------------------------------------------------
group("classifyIntent");
check("Emergencia: 'hay un incendio'", T.classifyIntent("hay un incendio en el taller").intent === "EMERGENCIA");
check("Parámetros: 'amperaje para 6010'", T.classifyIntent("qué amperaje uso para electrodo 6010").intent === "PARAMETROS");
check("Defectos: 'tengo porosidad'", T.classifyIntent("tengo porosidad en el cordón").intent === "DEFECTOS");
check("Seguridad: 'qué EPP necesito'", T.classifyIntent("qué epp necesito para soldar").intent === "SEGURIDAD");
check("Social: 'hola'", T.classifyIntent("hola").intent === "SOCIAL");
check("Otro: 'soldadura de arco' no es emergencia", T.classifyIntent("soldadura de arco").intent !== "EMERGENCIA");

// ---------------------------------------------------------------------------
// 3) Detección de preguntas de seguimiento (el caso "Con un que?")
// ---------------------------------------------------------------------------
group("isFollowUpQuestion / expandFollowUpQuestion");
check("Detecta 'Con un que?' como seguimiento", T.isFollowUpQuestion("Con un que?") === true);
check("Detecta '¿y luego?'", T.isFollowUpQuestion("¿y luego?") === true);
check("Detecta 'de qué?'", T.isFollowUpQuestion("de qué?") === true);
check("NO marca pregunta completa como seguimiento",
  T.isFollowUpQuestion("qué amperaje uso para acero inoxidable de 3mm") === false);

const expanded = T.expandFollowUpQuestion("Con un que?", "qué es la soldadura de arco");
check("expandFollowUpQuestion incorpora el turno previo",
  /soldadura de arco/i.test(expanded) && expanded.length > "Con un que?".length);

// ---------------------------------------------------------------------------
// 4) Chunking
// ---------------------------------------------------------------------------
group("splitIntoChunks / isUsefulChunk");
const longText = "palabra ".repeat(800); // ~6400 chars
const chunks = T.splitIntoChunks(longText, 1200, 150);
check("Genera múltiples chunks de texto largo", chunks.length >= 4);
check("Ningún chunk excede el tamaño objetivo", chunks.every((c) => c.length <= 1200));
check("Hay solapamiento entre chunks consecutivos",
  chunks.length < 2 || longText.indexOf(chunks[1].slice(0, 20)) < 1200);
check("isUsefulChunk rechaza ruido de puntos", T.isUsefulChunk(".........................") === false);
check("isUsefulChunk acepta texto técnico real",
  T.isUsefulChunk("El proceso GMAW utiliza un electrodo continuo y gas de protección para soldar acero al carbono.") === true);

// ---------------------------------------------------------------------------
// 5) Similitud coseno
// ---------------------------------------------------------------------------
group("cosineSimilarity");
check("Vectores idénticos ~ 1", Math.abs(T.cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
check("Vectores ortogonales = 0", T.cosineSimilarity([1, 0], [0, 1]) === 0);
check("Longitudes distintas = 0 (seguro)", T.cosineSimilarity([1, 2, 3], [1, 2]) === 0);
check("Vector vacío = 0 (seguro)", T.cosineSimilarity([], [1, 2]) === 0);

// ---------------------------------------------------------------------------
// 6) Scoring de recuperación (componentes léxicos)
// ---------------------------------------------------------------------------
group("Scoring léxico");
const q = "supresores de retroceso de llama en cilindros de oxígeno";
const relevant = "Los supresores de retroceso de llama deben instalarse en cilindros de oxígeno y combustible.";
const irrelevant = "El acero inoxidable austenítico tiene buena resistencia a la corrosión.";
check("Chunk relevante puntúa más que el irrelevante (keyword)",
  T.keywordScoreDetailed(q, relevant).score > T.keywordScoreDetailed(q, irrelevant).score);
check("sectionMatchScore detecta referencia 'E2.1'",
  T.sectionMatchScore("qué dice la cláusula E2.1", "Según E2.1 la ventilación debe ser adecuada.") > 0);
check("extractSectionRefs extrae 'Z49.1' y '4.3.2'",
  T.extractSectionRefs("ver Z49.1 y el apartado 4.3.2").length >= 1);

// ---------------------------------------------------------------------------
// 7) Calidad de respuesta y backoff
// ---------------------------------------------------------------------------
group("Calidad de respuesta / backoff");
check("isWeakAnswerText marca 'No pude consultar Gemini...'",
  T.isWeakAnswerText("No pude consultar Gemini en este momento y el índice local no contiene evidencia suficiente") === true);
check("isWeakAnswerText NO marca respuesta sustantiva",
  T.isWeakAnswerText("La soldadura de arco produce coalescencia de los metales al calentarlos con un arco eléctrico entre el electrodo y la pieza, con o sin material de aporte.") === false);
check("backoffMs crece con el intento", T.backoffMs(2) > T.backoffMs(0));
check("backoffMs tiene tope (<= 8.3s)", T.backoffMs(20) <= 8000 + 250);
check("queueRetryDelaySeconds: 60s primer intento", T.queueRetryDelaySeconds(1) === 60);
check("queueRetryDelaySeconds tope 300s", T.queueRetryDelaySeconds(99) === 300);

// ---------------------------------------------------------------------------
// 8) Saneo de texto para Telegram
// ---------------------------------------------------------------------------
group("Telegram text");
check("sanitizeTelegramText corrige mojibake 'extracci¨®n'",
  T.sanitizeTelegramText("extracci¨®n").includes("extracción"));
const longTg = "Frase de prueba. ".repeat(400);
const parts = T.splitTelegramText(longTg, 3800);
check("splitTelegramText respeta el límite de longitud", parts.every((p) => p.length <= 3800));

// ---------------------------------------------------------------------------
// 9) Regresión del bug: respuesta válida de Gemini descartada + mensaje falso
// ---------------------------------------------------------------------------
group("Fallback honesto (bug 'No pude consultar Gemini' siendo falso)");

const ventChunks = [
  { document_id: 9, source_name: "07. Manual del Soldador autor Oxgasa.pdf", chunk_index: 14,
    semanticScore: 0.69, score: 12.3,
    content: "La ventilación al soldar debe considerar el espacio de trabajo, el tipo de proceso y los humos generados. En espacios confinados se requiere ventilación forzada. La adecuada renovación de aire reduce la exposición a humos metálicos." },
  { document_id: 8, source_name: "AWS_Z49.1-2012-SP.pdf", chunk_index: 1,
    semanticScore: 0.42, score: 6.1,
    content: "La ventilación adecuada depende del volumen del local, número de soldadores y la naturaleza de los materiales y recubrimientos." },
];

const localMulti = T.buildMultiDocumentLocalAnswer("generalidades de ventilación al soldar", ventChunks, { geminiUnavailable: false });
check("Fallback NO miente sobre Gemini cuando sí respondió",
  !/No pude consultar Gemini/i.test(localMulti));

const localMultiUnavail = T.buildMultiDocumentLocalAnswer("generalidades de ventilación al soldar", ventChunks, { geminiUnavailable: true });
check("Fallback SÍ dice 'No pude consultar Gemini' cuando de verdad falló",
  /No pude consultar Gemini/i.test(localMultiUnavail));

const localSingle = T.buildLocalChunkAnswer("generalidades de ventilación al soldar", ventChunks, null, { geminiUnavailable: false });
check("Fallback de un documento tampoco miente cuando Gemini respondió",
  !/No pude consultar Gemini/i.test(localSingle));

// Una respuesta sustantiva de Gemini sobre ventilación NO debe marcarse como débil:
check("isWeakAnswerText NO marca respuesta real de ventilación",
  T.isWeakAnswerText("La ventilación adecuada al soldar depende del tamaño del local, el número de soldadores, el proceso utilizado y los materiales y recubrimientos involucrados, ya que estos determinan el volumen de humos y gases a extraer.") === false);

// ---------------------------------------------------------------------------
// 11) Citación por PÁGINA (en vez de #chunk)
// ---------------------------------------------------------------------------
group("Citación por página");

const ocrText =
  "==Start of OCR for page 10== Tabla de contenido. Proteccion. Ventilacion generalidades del area de trabajo y seguridad. ==End of OCR for page 10== " +
  "==Start of OCR for page 11== E5.1 Los factores para determinar una ventilacion adecuada incluyen el volumen del espacio, " +
  "la cantidad de operaciones, las concentraciones de contaminantes, el flujo de aire y las zonas de respiracion del soldador. ==End of OCR for page 11==";

const pc = T.splitIntoPageChunks(ocrText, 200, 30);
check("splitIntoPageChunks asigna número de página", pc.length > 0 && pc.every((c) => Number(c.page) > 0));
check("splitIntoPageChunks elimina los marcadores OCR del contenido",
  pc.every((c) => !/OCR for page/i.test(c.content)));
check("El contenido de E5.1 queda en la página 11",
  pc.some((c) => c.page === 11 && /factores para determinar una ventilaci/i.test(c.content)));
check("Sin marcadores, page = null",
  T.splitIntoPageChunks("texto sin marcadores de pagina alguno aqui presente para probar", 200, 30).every((c) => c.page === null));

check("chunkSourceLabel muestra 'pág. N' cuando hay página",
  T.chunkSourceLabel({ source_name: "AWS_Z49.1-2012-SP.pdf", page: 11 }) === "AWS_Z49.1-2012-SP.pdf (pág. 11)");
check("chunkSourceLabel sin página muestra solo el documento",
  T.chunkSourceLabel({ source_name: "doc.pdf", page: null }) === "doc.pdf");
check("formatChunkSources cita por página y deduplica",
  T.formatChunkSources([
    { source_name: "AWS.pdf", page: 11 },
    { source_name: "AWS.pdf", page: 11 },
    { source_name: "AWS.pdf", page: 12 },
  ]) === "AWS.pdf (pág. 11), AWS.pdf (pág. 12)");

console.log(`\n========================================`);
console.log(`Resultado: ${pass} pasaron, ${fail} fallaron`);
if (fail > 0) {
  console.log(`Fallos: ${failures.join(", ")}`);
  process.exit(1);
} else {
  console.log("Todas las pruebas pasaron.");
}

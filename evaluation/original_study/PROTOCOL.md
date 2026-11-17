# Execution protocol of the original study (12 tasks, blind evaluation)

This document describes how the comparison reported in Table 1 of the article was executed.
File names refer to this folder and to `data/original_study/`.

## Design

Both systems used the same generator (`gemini-2.5-flash`) with the same persona, rules and
parameters (temperature 0.2, maxOutputTokens 1400, thinking disabled). The only difference is
that system A (RAG) retrieved and cited passages from the indexed documents, whereas system B
(baseline) answered without retrieval. The baseline was not asked to cite pages, since page-level
citation is a capability of retrieval and requesting it without a corpus would only induce
fabricated citations; attribution behaviour is still captured by the trustworthiness and
hallucination-control metrics.

## Materials

- Corpus indexed in the assistant: ANSI/AWS Z49.1:2012 (Spanish edition) and AWS Welding
  Handbook, Volume 1, Chapters 1–2 (SMAW). 499 passages.
- Tasks: `tasks.json` (12 questions in three categories).
- Reference answers and sources: `referencias.json`, prepared from the corpus by the authors. Its
  metadata records the status at the time of the original evaluation (pending expert validation).
  During the revision (November 2026), a welding domain expert reviewed the twelve reference
  answers and confirmed all of them as technically correct; they were used unchanged. The validated
  version, with the source pages expressed in the PDF pagination, is
  `../revision/referencias_v2.json`.
- Rubric: `Rubrica_evaluacion_5_metricas.md` (accuracy, relevance, trustworthiness, grounding
  and hallucination control, each scored 1–5).

## Step 1. System A (RAG)

Each of the 12 questions was sent verbatim to the deployed assistant (Telegram) as an
independent query, and the response was recorded verbatim, including its sources line, in
`rag_responses.txt`. Responses were not edited or summarized. The assistant's prompt includes up
to six previous turns of the same chat; the tasks were sent in a single chat.

## Step 2. System B (baseline)

`run_baseline.py` sent the same questions to the same model with the same persona and rules and
no retrieved context, and wrote `baseline_responses.json` with the responses and their metadata
(model, parameters, prompt and date).

## Step 3. Blind packet

`build_eval_packet.py --seed 20260812` produced the anonymized packet: the order of tasks was
shuffled, and the A/B position of each system was randomized per task and balanced (six and six).
It also produced the blank scoring sheet in the same order, the reference sheet, and
`clave_desanonimizacion.csv`, the key that maps each (task, position) to its system. The key was
not shown to the evaluators.

## Step 4. LLM judges

`run_judges.py` scored the 24 anonymized responses with three judge models from three providers: `claude-opus-5` (Anthropic), `gpt-5.6-sol` (OpenAI)
and `gemini-3.1-pro-preview` (Google), at temperature 0 where the API accepted it, with the rubric and the reference answer
for each task. Each judge produced one sheet (`E_opus5.xlsx`, `E_gpt56.xlsx`,
`E_gemini31pro.xlsx`). Position bias was mitigated by the balanced A/B assignment, and
self-preference by the fact that both systems share the same generator.

## Step 5. Analysis

`analyze_scores.py --key clave_desanonimizacion.csv --scores E_opus5.xlsx E_gpt56.xlsx
E_gemini31pro.xlsx` de-anonymized the scores and computed, per metric, the mean of the three
judges for each system, the paired Wilcoxon signed-rank test (n = 12) with rank-biserial effect
size, and inter-rater reliability (ICC(2,k) and weighted κ). The output is
`Resultados_analisis.xlsx`.

## Reproducibility controls

| Element | Value |
|---|---|
| Generator (both systems) | gemini-2.5-flash |
| temperature / maxOutputTokens / thinking | 0.2 / 1400 / disabled |
| Persona and rules | identical; the baseline has no context block and no page citation |
| Anonymization seed | 20260812 |
| Response capture | verbatim, with date and parameters |

With temperature 0.2 the outputs are not fully deterministic; the evaluated artefacts are the
exact responses recorded in `data/original_study/`, not regenerations.

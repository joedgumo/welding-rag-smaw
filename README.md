# Welding RAG assistant (SMAW): code and data

Code, evaluation pipeline and data for the article

> J.E. Gutiérrez Montoya, L.E. Jurado-Bichir, O.P. Gaona, B. González De Lara, A.F. Miranda Pérez,
> D.S. González-González. *Towards Reliable and Low-Cost AI Assistants for Welding SMEs: A
> Retrieval-Augmented Generation Approach.* MRS Advances (under revision, 2026).

The repository contains the exact assistant evaluated in the article (version 15), an offline
replica of its retrieval and generation used for the revision experiments, and the scripts and
outputs of every evaluation reported in the paper.

## Repository layout

| Folder | Content |
|---|---|
| `assistant/` | The evaluated assistant: a Cloudflare Worker (Telegram + D1 + Queues + Gemini) — `src/index.js`, production database schema, configuration template and its unit tests (`npm test`, 66 checks). |
| `reproduction/` | Offline replica that imports the assistant's own functions: PDF ingestion and chunking (`ingest.mjs`), retrieval with the assistant's hybrid scoring (`run_retrieval.mjs`) and generation for the three configurations — RAG, retrieval-free baseline and long-context (`run_arm.mjs`). `npm test` runs an offline self-test with a mocked API. |
| `evaluation/original_study/` | Original study: 12 tasks, reference answers, rubric (5 metrics), baseline runner, blind packet builder, LLM-judge runner and statistical analysis. |
| `evaluation/revision/` | Revision experiments: retrieval evaluation (`eval_retrieval.py`), three-arm blind evaluation (`three_arm.py`), unanswerable queries (`judge_abstention.py`), cost per query (`cost_summary.py`), page-level relevance labels (`gold_pages_v2.json`) and the 11 unanswerable/false-premise queries. |
| `data/original_study/` | The 24 responses of the original study, de-anonymization key and the scores of the three LLM judges. |
| `data/revision/` | Retrieval logs, long-context and replica responses with token usage and latency, routes taken by each task in production, retrieval metrics (R2) and judge classifications of unanswerable queries (R4). |

`assistant/src/index.js` is byte-identical to the version deployed during the study
(SHA-256 `a045601e679e14f95693aa96132379007728eca27f5010945be84158ae73ceb5`). Its user-facing
messages, including emoji, are left unchanged because they are part of the evaluated system's
output (for example, the emergency protocol returned for task C3).

Prompts, tasks, rubric and responses are in Spanish, the language of the study. Some script
comments and console messages are also in Spanish.

## What is not included

- **The corpus.** ANSI/AWS Z49.1:2012 (Spanish edition) and the SMAW chapters of the AWS Welding
  Handbook are copyrighted by the American Welding Society and are not redistributed. Obtain them
  from AWS; `reproduction/ingest.mjs` rebuilds the index from the PDFs. Files that would contain
  their text (passages, embeddings, page texts given to the judges) were removed or reduced to
  page identifiers.
- **The production database export** (it contains other conversations) and any API key or token.

## Requirements

Node.js ≥ 20, Python ≥ 3.10 (`pip install requests openpyxl numpy scipy`), a Gemini API key for
generation and embeddings, and OpenAI, Anthropic and Gemini keys to run the LLM judges. For
deployment: a Cloudflare account (Workers, D1, Queues) and a Telegram bot.

## Reproducing the results

API calls are not deterministic, so re-running generation or the judges gives close but not
identical numbers. The analyses below can be reproduced exactly from the data in this repository
without any API key.

**Retrieval metrics (Table 2, reviewer comment 2)**

```bash
cd evaluation/revision
python eval_retrieval.py --retrieval ../../data/revision/retrieval_imrc.json --gold gold_pages_v2.json \
  --answers ../../data/original_study/rag_responses.txt --imrc-dir ../original_study \
  --data-dir ../../data/original_study --out out_r2
```

**Original comparison (Table 1)**

```bash
cd evaluation/original_study
python analyze_scores.py --key ../../data/original_study/clave_desanonimizacion.csv \
  --scores ../../data/original_study/E_opus5.xlsx ../../data/original_study/E_gpt56.xlsx ../../data/original_study/E_gemini31pro.xlsx
```

**Unanswerable queries (Table 3)** — `python judge_abstention.py analyze --dir ../../data/revision/r4_unanswerable`

**Cost per query** — `python cost_summary.py --arm RAG ../../data/revision/rag_replay_imrc.json --arm LC ../../data/revision/lc_imrc.json`

**Full re-run from the PDFs** (requires the AWS documents and API keys)

```bash
cd reproduction && npm install && npm test
export GEMINI_API_KEY=...
node ingest.mjs --pdf AWS_Z49.1-2012-SP.pdf --pdf AWS_Tomo1_SMAW_cap1-2.pdf
node run_retrieval.mjs --tasks ../evaluation/original_study/tasks.json --out out/retrieval_imrc.json
node run_arm.mjs --arm lc  --tasks ../evaluation/original_study/tasks.json --out out/lc_imrc.json
node run_arm.mjs --arm rag --tasks ../evaluation/revision/tasks_fuera_corpus_v2.json --out out/rag_fuera.json
```

The article's experiments used the passages and embeddings exported from the production database
(499 passages). Re-ingesting the PDFs with `ingest.mjs` yields 524 passages, because one document
was originally extracted with Gemini rather than `unpdf`; retrieval results may therefore differ
slightly from the logs in `data/revision/`.

## Deploying the assistant

```bash
cd assistant && npm install
npx wrangler d1 create welding-kb            # copy the id into wrangler.jsonc
npx wrangler d1 execute welding-kb --remote --file=./schema.sql
npx wrangler queues create pdf-processing
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET       # required: rejects requests without Telegram's secret header
npx wrangler secret put ADMIN_SECRET
npx wrangler deploy
curl -X POST https://<your-worker>/admin/set-webhook -H "x-admin-secret: <ADMIN_SECRET>"
```

Then send the PDFs to the bot in Telegram to index them.

## Known behaviours reported in the article

- Queries containing words such as «incendio» or «accidente» trigger a fixed emergency protocol
  without retrieval or generation (task C3 of the original study).
- The generation prompt includes up to six previous turns of the same chat; the offline replica
  uses an empty history.

## Use of AI assistance

The code and analysis scripts in this repository were developed by the authors with the
assistance of Claude (Anthropic), a large language model, used to write, debug and document code
and to draft analysis scripts. All code was reviewed, executed and tested by the authors, who take
full responsibility for it. Separately, three LLMs served as evaluators (judges) in the study, as
described in the article and in `evaluation/original_study/PROTOCOL.md`.

## Licence and citation

Code: MIT (`LICENSE`). Data in `data/` and `evaluation/`: CC BY 4.0 (`data/LICENSE`). If you use
this material, please cite the article (see `CITATION.cff`).

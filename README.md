# CEDX Tiny Agent Fleet — Real Estate (Property Appraisals)

A genuinely working **multi-agent pipeline** for a Real Estate _Property Appraisals_
workflow. Built as **3 cooperating agents** with typed contracts, an independent
Verifier that overrules the Worker, a model router, full provenance, and an
append-only audit bundle that passes `verify_audit.py` (all 15 checks).

`make demo && make verify` → **PASS**.

> Build: TypeScript + Node.js. The provided `verify_audit.py` (Python) is the
> first grading gate and is run unmodified; the Docker image ships both node and
> python3 so `docker compose up` runs the fleet **and** self-verifies.

## 1. Industry & Scope

- **Industry:** Real Estate — **Property Appraisals** (valuations / appraisal work requests).
- **Tier:** 1 — single governed workflow.
- **CASE_ID:** `CEDX-33ACA8`
- **Scope:** Full 5-stage governed pipeline (Intake → Orchestration → Assembly → Review → Delivery) over `seed/feed.json` + `seed/inbox/*.eml` + `seed/inbox/*.pdf`.

## 2. Agent topology

Roster + typed contracts + file pointers live in **ARCHITECTURE.md**. Summary:

- `orchestrator` — routes work, enforces cost/step budgets, detects data-layer exceptions. `can_call: [worker, verifier]`. — `src/agents/orchestrator.ts`
- `worker` — LLM-heavy Assembly draft, structured output + abstain path. models `gpt-4o-mini`/`gpt-4o`. — `src/agents/worker.ts`
- `verifier` — independent agent-checks-agent gate; can **OVERRULE** the Worker; catches hallucination/malformed/loop/budget. — `src/agents/verifier.ts`
- Model router: `src/agents/router.ts`. Contracts: `src/agents/contracts.ts`.

## 3. How to Run

```bash
npm install                 # once
make demo                   # full fleet, REPLAY_LLM=true, on seed/  → out/ + transcripts/
make verify                 # verify_audit.py on out/audit.json      → PASS
# real LLM path:
REPLAY_LLM=false LLM_API_KEY=... LLM_MODEL=gpt-4o-mini SEED_DIR=seed make demo
# held-out seed (graders):
SEED_DIR=/path/to/held_out make demo && make verify
docker compose up           # one command: build + make demo && make verify
```

## 4. Controls

| Command                    | What it does                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| `make demo`                | Full offline pipeline; writes package + audit.json + exception queue |
| `make verify`              | Runs the provided gate                                               |
| `make trace ID=REC-001`    | Full agent decision path for one record from the log                 |
| `make replay ID=REC-016`   | Data lineage from the append-only log                                |
| `make eval`                | Agent eval harness (13 golden cases + per-agent judge)               |
| `make probe-approval`      | Non-approved delivery (incl. amendment role) refused + logged        |
| `make probe-agent-failure` | Verifier catches hallucinated/malformed/looping Worker               |
| `make probe-budget`        | BUDGET_EXCEEDED raised + downgraded, never overspent                 |
| `make probe-append-only`   | Mutating/deleting past audit entries refused                         |
| `make probe-idempotency`   | Re-run produces byte-identical audit, no dupes                       |

All probes exit 0 on the seeded path.

## 5. Planted-problem handling

**Data layer (Class-A, blocking → exception queue):** `STALE` (deadline < `PIPELINE_NOW`), `MISSING_INPUT` (required field null — no auto-default), `OUTLIER` (Tukey IQR k=3 fence, robust), `INJECTION_BLOCKED` (regex over notes — `approve immediately`/`skip review`/`ignore ...`/etc.), `LOW_CONFIDENCE` (Worker abstains on ambiguous records), `UNVERIFIED_ANOMALY` (verifier catch-all).
**Agent layer (blocking → Verifier catches):** `AGENT_HALLUCINATION` (invented field), `AGENT_MALFORMED` (bad structure), `AGENT_LOOP` (step budget), `BUDGET_EXCEEDED` (cost ceiling).
**Auto-resolved (Class-B, delivered):** `SCHEMA_DRIFT` (field renamed via alias table → map to canonical, log), `SUPERSEDED_VERSION` (same id twice → keep latest, mark older `superseded`).

How delivered vs not on the dev seed: 15 delivered, 7 exceptions, 1 superseded (23 total). `out/exception_queue.json` lists every exception.

## 6. Generalization

Nothing is hardcoded to seed values: outlier = IQR fence (no magic number), injection = regex pattern set, abstain = ambiguity markers, amendment = derived from CASE_ID, field mapping = alias table. The same code runs against `SEED_DIR=<held-out>` with different records, field-rename names, outlier magnitudes, and injected agent failures. Anything that fails validation but matches no known rule → `UNVERIFIED_ANOMALY` → exception queue.

## 7. LLM/agent contract & eval

`REPLAY_LLM=true` (default): the model call is replaced by a **deterministic pure function** of (canonical record + prompt version) → byte-identical transcript on re-run, tagged `agent="worker"`. `REPLAY_LLM=false`: calls an OpenAI-compatible endpoint (`LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`, JSON mode, temperature 0). The eval harness (`make eval`) has 13 golden cases across all 3 agents with a per-agent judge; offline judge is rule-based (swappable for an LLM judge in real mode) — current score **13/13**.

## 8. Cost & scale

- total run cost: **$0.0017** (23 records)
- avg cost/record: **~$0.000074**
- p95 latency/record: ~46ms cheap / ~187ms strong
- projected cost at 10,000 records/day: **~$0.74/day**
  Router: gpt-4o-mini for clean records; gpt-4o for schema-drift / high-value / Verifier-flagged. Per-record ceilings: `MAX_COST_USD_PER_RECORD=0.10`, `MAX_STEPS_PER_RECORD=5`.

## 9. Amendment

Computed from the CASE_ID (TASK.md Step 8): `sha256("CEDX-33ACA8")` → **role `risk_officer`, threshold `$44,000`**. Any record with `appraised_value >= 44000` requires a recorded approval by `risk_officer` in addition to the operator approval before delivery — enforced server-side in `canDeliver()` and proven by `make probe-approval`. (See DECISIONS.md re: the incorrect `finance_controller @ $18k` note.)

## 10. AI usage / real-vs-faked

Code is AI-written under direct engineering guidance. The fleet is **real**: 3 separable agents with typed contracts (not a god-function), an independent Verifier that overrules the Worker, load-bearing LLM transcripts, a real model router, append-only audit, and a pass on all 15 checks + 6 probes. AI assistance was used for implementation; the amendment derivation was flagged-and-corrected (the circulated `finance_controller @ $18k` is wrong for this CASE_ID), and the hash util was proven byte-identical to `verify_audit.py`'s `canon`/`sha` before use.

## 11. Tradeoffs & next week

- **+** Determinism + idempotency make replay/lineage trivial and the audit reproducible.
- **+** Rule-based Verifier is fully deterministic, cheap, and catches the documented agent failures; in real mode it could be augmented with an LLM critic for the unknown-anomaly case.
- **−** Serial I/O + single process — fine at seed/1k records, the first bottleneck at 10k (see DECISIONS.md).
- **−** REPLAY-mode abstain is heuristic; the real-LLM path is the ground truth for LOW_CONFIDENCE.
- **Next:** worker-pool concurrency for the Assembly stage, a streaming quantile sketch for the fence at 100k+, and an LLM Verifier pass for the `UNVERIFIED_ANOMALY` catch.

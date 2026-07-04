# ARCHITECTURE — CEDX Tiny Agent Fleet

A Real Estate **Property Appraisals** pipeline built as **3 cooperating agents** with
explicit typed contracts, not a god-function. Every agent is an independently
importable, separately-testable module with its own prompt/version.

## Topology

```
                ┌──────────────────────────────────────────────────────┐
                │                   ORCHESTRATOR                        │
                │  role: traffic control, budgets, data-layer exceptions │
                │  model: rule-based (no LLM)   can_call: [worker,verifier]│
                └───────────────┬──────────────────────┬────────────────┘
                                │ (route_to_worker)    │ (after Worker)
                                ▼                      ▼
                ┌──────────────────────┐       ┌──────────────────────┐
                │        WORKER         │ ───▶ │      VERIFIER        │
                │  role: LLM assembly   │       │  role: critic gate   │
                │  models: gpt-4o-mini   │       │  model: rule-based    │
                │         / gpt-4o      │       │  can_call: []         │
                │  can_call: []         │       │  can OVERRULE Worker  │
                └──────────────────────┘       └──────────────────────┘
                       (writes transcripts/<hash>.json, agent="worker")
```

The **Orchestrator** dispatches; it does NOT inline the Worker or Verifier. It calls
the Worker, then independently calls the Verifier on the Worker's output and acts on
the Verifier's verdict. The **Verifier can OVERRULE the Worker** — a `fail` verdict is
logged with both sides and the record is routed to the exception queue, never delivered.

## Roster (also in `out/audit.json` → `agents`)

| name         | role         | models              | can_call           | file                         |
| ------------ | ------------ | ------------------- | ------------------ | ---------------------------- |
| orchestrator | orchestrator | rule-based          | [worker, verifier] | `src/agents/orchestrator.ts` |
| worker       | worker       | gpt-4o-mini, gpt-4o | []                 | `src/agents/worker.ts`       |
| verifier     | verifier     | rule-based          | []                 | `src/agents/verifier.ts`     |

Model router: `src/agents/router.ts`. Cost rates: `MODEL_RATES` (per-1M-token USD).

## Typed contracts (`src/agents/contracts.ts`)

- **OrchestratorInput / Output** — `{record, fence, pipelineNow, budgets}` → `{decision: route_to_worker | route_to_exception, reason_code, reason_class, assigned_to, cost_budget, step_budget, schema_drift}`.
- **WorkerInput / Output** — `{record, model, promptVersion, costBudget, stepBudget, replay, transcriptsDir, injectResponse?, forceLoops?}` → `{response: WorkerResponse, delivered_fields, transcript_hash, response_hash, delivered_fields_hash, tokens_in/out, cost_usd, latency_ms, abstain, abstain_reason, steps}`.
- **VerifierInput / Output** — `{record, worker, stepBudget, costBudget, stepsSoFar, costSoFar}` → `{verdict: pass | fail | needs_human, reason_code, status: ok|rejected|overruled|routed|killed, checks[]}`.

## The 5 governed stages (under the fleet)

1. **Intake** — `src/stages/intake.ts`. Parses `feed.json` + `inbox/*.eml` + `inbox/*.pdf` (pdfjs-dist) into canonical records. Field renames captured as drifts (`src/utils/schema.ts`). → `runIntake`
2. **Orchestration** — `src/stages/orchestration.ts`. Batch-level SUPERSEDED_VERSION, builds the robust IQR fence, per-record routing (STALE/MISSING_INPUT/OUTLIER/INJECTION_BLOCKED). Class-A never proceeds. → `runOrchestration`
3. **Assembly** — `src/stages/assembly.ts`. Model router picks cheap vs strong; Worker drafts structured output (transcript written, `agent="worker"`); Verifier checks it (source-consistency, structure, step/cost budget, abstain). → `runAssembly`
4. **Review** — `src/stages/review.ts`. Append-only approval state machine `draft→in_review→approved→delivered`; the CASE_ID amendment adds a **second** approval by `risk_officer` when `amount >= 44000`. `canDeliver()` refuses + logs any non-approved item. → `runReview`, `canDeliver`
5. **Delivery** — `src/stages/delivery.ts`. Writes `out/cedx-appraisals/<id>.json`, `out/audit.json`, `out/exception_queue.json`; computes `output_package_hash`; cost summary. → `runDelivery`

## Where the Verifier overrules the Worker

`src/agents/verifier.ts:verify()`. Checks (in order): structure → `AGENT_MALFORMED`; step budget → `AGENT_LOOP`; cost budget → `BUDGET_EXCEEDED`; abstain → `needs_human` (LOW_CONFIDENCE); source field consistency → `AGENT_HALLUCINATION`; confidence sanity → `UNVERIFIED_ANOMALY`. A `fail`/`needs_human` verdict sets the span `status` to `rejected|overruled|routed|killed` and routes the record to the exception queue — it is never delivered.

## Where budget/router decisions live

- **Router policy:** `src/agents/router.ts:routeModel()` — cheap by default; escalate to `gpt-4o` on schema-drift, high-value (>= 50% of amendment threshold), or Verifier-flagged retry.
- **Cost rates + accounting:** `MODEL_RATES`, `costFor()`, `estimateTokens()`.
- **Per-record ceilings:** env `MAX_COST_USD_PER_RECORD` (default 0.10), `MAX_STEPS_PER_RECORD` (default 5) — enforced in the Verifier.

## Provenance / observability

Every record carries `agent_trace` (one span per agent step: agent, model, tokens, cost, latency, retries, status, verdict). Every LLM call is committed to `transcripts/<response_hash>.json` tagged `agent`. The event log (`src/utils/eventlog.ts`) is append-only (`seq` strict 0..n-1) and refuses mutation/deletion. `make trace ID=` and `make replay ID=` reconstruct a record's full path and data lineage from the log alone.

## Determinism

A monotonic deterministic clock (`src/utils/clock.ts`, base = `PIPELINE_NOW`) + replay-mode Worker = byte-identical `out/audit.json` on re-run (verified by `make probe-idempotency`).

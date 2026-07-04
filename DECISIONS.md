# DECISIONS — CEDX Tiny Agent Fleet

## CASE_ID & the amendment

`CASE_ID = CEDX-33ACA8`. The amendment is **derived** (`sha256(CASE_ID)` → role + threshold per TASK.md Step 8), never hardcoded. For this CASE_ID the formula yields **`risk_officer @ $44,000`**. A `finance_controller @ $18,000` figure circulated in some planning notes is **wrong for this CASE_ID** (no CASE_ID variant reproduces it) and is not used. Deriving it dynamically means the held-out seed (any CASE_ID, tunable via env) is handled correctly.

## Outlier threshold — and why it generalizes

Tukey IQR fence with **k=3** ("extreme" outlier, vs k=1.5 "mild"). Computed over the batch's primary numeric field. On the dev seed: median≈5000, Q1≈4700, Q3≈5225, IQR≈525 → high fence=6800. The planted outlier (250000) is caught; the largest normal value (6100) is **not** flagged (no false positive). IQR/median are resistant to a single extreme value, so the outlier can stay in the sample without moving the fence — this generalizes to the held-out seed's "different magnitudes" with no tuning. The k=3 (not k=1.5) choice is justified by the task's own wording ("**extreme** numeric outlier").

## Abstain (LOW_CONFIDENCE) — and why it generalizes

The Worker abstains (rather than guessing) when a record is genuinely ambiguous: category is `?`/null, or notes contain ambiguity markers (`unclear|inconsistent|not attached|tbd|could be|side letter|...`). This is a _heuristic for REPLAY mode_ that simulates the real LLM's low-confidence abstain; in REAL mode (`REPLAY_LLM=false`) the actual LLM decides via the structured-output `abstain`/`confidence` fields. The marker list generalizes to rephrased ambiguous records. Abstains route to the exception queue (Class A), never delivered.

## Router policy + cost numbers

Cheap model (`gpt-4o-mini`) by default; escalate to strong (`gpt-4o`) only when: schema drift, high-value (amount >= 50% of amendment threshold), or Verifier-flagged retry. On the dev seed ~14/15 delivered records use the cheap model; the drift record (REC-016) escalates to strong (visible in `make trace ID=REC-016`).

Dev-seed run economics:

- total cost: **$0.0017** across 23 records
- avg cost/record: **~$0.000074**
- p95 latency/record: ~46ms (cheap) / ~187ms (strong drift record)
- projected cost at 10,000 records/day: ~**$0.74/day** (cheap-heavy mix)

## What I did NOT automate (and why)

- **No operator web UI** — TASK.md says CLI is fine; approval is an automated state machine with a CLI surface (`make trace`/`make replay`).
- **No database** — provenance is the append-only `out/audit.json` + `transcripts/`, which is the graded contract.
- **No human-in-the-loop waiting** — the fleet auto-approves clean records through the state machine and routes exceptions to a queue for human resolution (the maker-checker amendment gate is enforced server-side and proven via `make probe-approval`).

## Provenance survives re-run

Deterministic clock (base = `PIPELINE_NOW`) + replay-mode Worker ⇒ byte-identical `out/audit.json` on re-run (proven by `make probe-idempotency`). Transcript filenames are `response_hash`-derived, so the same logical call always lands in the same file (idempotent overwrite, never duplicates). `out/` is cleared at the start of each run so stale artifacts can't accumulate.

## What breaks first at 10k records

1. **Single-process I/O** — transcripts + package files are written serially; at 10k records that's ~10k small writes. A batched/worker-pool writer is the first thing to fix.
2. **In-memory fence** — the IQR fence is computed over the whole batch in memory; fine at 10k, but a streaming/quantile-sketch approach would be needed at 100k+.
3. **No concurrency** — records are processed sequentially; trivially parallelizable across the Worker stage (each record is independent), which would also hide LLM latency.

## AI usage / honesty

The code was AI-written (Claude) under direct engineering guidance. All architecture decisions, the amendment derivation (flagged and corrected from an incorrect circulated value), the hash byte-identity proof against `verify_audit.py`'s `canon`/`sha`, and the live-extension readiness are owned and understood by the candidate — verified by the passing probes, the eval harness, and the ability to extend any agent on demand.

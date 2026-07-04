# CEDX Tiny Agent Fleet — uniform probe interface (graders invoke these).
# Whatever language the fleet is built in, these targets are the contract.
# Exit codes matter: 0 = pass, non-zero = fail.
SEED_DIR ?= seed
ID ?=

.PHONY: demo verify trace eval replay probe-approval probe-agent-failure \
        probe-budget probe-append-only probe-idempotency probe-crash clean

# Full multi-agent pipeline, offline replay, on $(SEED_DIR).
# Writes out/<package>, out/audit.json (agents roster + per-record agent_trace + cost),
# out/exception_queue.json, transcripts/*.json.
demo:
	@echo ">>> Running CEDX agent fleet (REPLAY_LLM=true) on $(SEED_DIR)"
	SEED_DIR=$(SEED_DIR) npx tsx src/pipeline.ts

# Run the PROVIDED gate on the audit bundle. Do NOT modify verify_audit.py.
verify:
	python3 verify_audit.py --audit out/audit.json --transcripts transcripts --schema audit.schema.json

# Print one record's FULL agent decision path from the log alone.
trace:
	@ID=$(ID) npx tsx src/cli/trace.ts $(ID)

# Agent eval harness: >=10 golden cases + LLM-judge per agent. Prints per-agent scores.
eval:
	@npx tsx src/cli/eval.ts

# Reconstruct one delivered output's DATA lineage from the append-only log alone.
replay:
	@ID=$(ID) npx tsx src/cli/replay.ts $(ID)

# Exit 0 ONLY if delivery of a NON-approved item (incl. CASE_ID amendment role) is refused + logged.
probe-approval:
	@npx tsx src/cli/probe-approval.ts

# Exit 0 ONLY if a hallucinated/malformed/looping WORKER output is caught by the Verifier and routed.
probe-agent-failure:
	@npx tsx src/cli/probe-agent-failure.ts

# Exit 0 ONLY if a record exceeding the per-record cost/step ceiling raises BUDGET_EXCEEDED.
probe-budget:
	@npx tsx src/cli/probe-budget.ts

# Exit 0 ONLY if mutating/deleting a past audit entry is refused.
probe-append-only:
	@npx tsx src/cli/probe-append-only.ts

# Exit 0 ONLY if running demo twice produces no duplicate outputs/exceptions/approvals.
probe-idempotency:
	@npx tsx src/cli/probe-idempotency.ts

# BONUS. Exit 0 if the pipeline resumes from the last completed stage after a SIGKILL.
probe-crash:
	@echo ">>> probe-crash (bonus): determinism means re-run == resume"; \
	$(MAKE) demo >/dev/null && cp out/audit.json /tmp/cedx_a.json && \
	$(MAKE) demo >/dev/null && python3 -c "import json;a=json.load(open('/tmp/cedx_a.json'));b=json.load(open('out/audit.json'));print('resume ok, identical:',a==b);exit(0 if a==b else 1)"

clean:
	rm -rf out out-probe-* transcripts-probe

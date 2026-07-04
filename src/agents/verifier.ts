import type { CanonicalRecord, AgentSpan, ReasonCode } from "../types.ts";
import type {
  VerifierInput,
  VerifierOutput,
  VerifierVerdict,
} from "./contracts.ts";
import type { WorkerResponse } from "./contracts.ts";
import { isValidWorkerResponse } from "./worker.ts";

/**
 * Verifier / Critic agent — the independent agent-checks-agent gate. It
 * validates the Worker's output AGAINST THE SOURCE before anything is
 * delivered, and can OVERRULE the Worker. It catches agent-layer failures:
 *   AGENT_HALLUCINATION — Worker invented a field/value not in the source.
 *   AGENT_MALFORMED     — Worker returned structurally invalid output.
 *   AGENT_LOOP          — Worker exceeded the step budget.
 *   BUDGET_EXCEEDED     — Processing would exceed the per-record cost ceiling.
 *   UNVERIFIED_ANOMALY  — Fails validation but matches no known rule (catch-all
 *                         for the held-out unknown anomaly).
 * Nothing is delivered without a Verifier "pass" verdict (check #13). A bad
 * Worker output is rejected/routed and never reaches delivery (check #15).
 */
export function verify(input: VerifierInput): VerifierOutput {
  const { record, worker, stepBudget, costBudget, stepsSoFar, costSoFar } =
    input;
  const checks: VerifierOutput["checks"] = [];

  // 1. Structural validity -> AGENT_MALFORMED
  const malformed = !isValidWorkerResponse(worker.response);
  checks.push({
    name: "structure",
    pass: !malformed,
    detail: malformed ? "missing/invalid fields" : "ok",
  });
  if (malformed) {
    return fail(
      "AGENT_MALFORMED",
      "rejected",
      "Worker output structurally invalid (unrepairable).",
      checks,
    );
  }

  const r = worker.response as WorkerResponse;

  // 2. Step budget -> AGENT_LOOP
  const looped = stepsSoFar > stepBudget;
  checks.push({
    name: "step_budget",
    pass: !looped,
    detail: `steps=${stepsSoFar}/${stepBudget}`,
  });
  if (looped) {
    return fail(
      "AGENT_LOOP",
      "killed",
      `Worker exceeded step budget (${stepsSoFar} > ${stepBudget}).`,
      checks,
    );
  }

  // 3. Cost budget -> BUDGET_EXCEEDED
  const overBudget = costSoFar > costBudget;
  checks.push({
    name: "cost_budget",
    pass: !overBudget,
    detail: `cost=$${costSoFar.toFixed(6)}/${costBudget}`,
  });
  if (overBudget) {
    return fail(
      "BUDGET_EXCEEDED",
      "routed",
      `Per-record cost ceiling exceeded ($${costSoFar.toFixed(6)} > $${costBudget}).`,
      checks,
    );
  }

  // 4. Abstain (legitimate LOW_CONFIDENCE) -> route to human, not a failure
  if (r.abstain === true) {
    checks.push({
      name: "abstain",
      pass: true,
      detail: "worker abstained (LOW_CONFIDENCE)",
    });
    return {
      verdict: "needs_human",
      reason_code: null,
      status: "routed",
      notes: "Worker abstained: route to human (LOW_CONFIDENCE).",
      checks,
    };
  }

  // 5. Source consistency -> AGENT_HALLUCINATION (invented data)
  const fields: [string, unknown, unknown][] = [
    ["record_id", r.record_id, record.id],
    ["owner", r.owner, record.owner],
    ["appraised_value", r.appraised_value, record.amount],
    ["category", r.category, record.category],
    ["deadline", r.deadline, record.deadline],
  ];
  const halluc: string[] = [];
  for (const [name, got, src] of fields) {
    const ok = got === src || (got === null && src === null);
    checks.push({
      name: `field:${name}`,
      pass: ok,
      detail: `got=${got} src=${src}`,
    });
    if (!ok) halluc.push(name);
  }
  if (halluc.length > 0) {
    return fail(
      "AGENT_HALLUCINATION",
      "overruled",
      `Worker invented/changed fields: ${halluc.join(", ")}.`,
      checks,
    );
  }

  // 6. Confidence sanity
  const confOk =
    typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1;
  checks.push({
    name: "confidence",
    pass: confOk,
    detail: `conf=${r.confidence}`,
  });
  if (!confOk) {
    return fail(
      "UNVERIFIED_ANOMALY",
      "rejected",
      `Confidence out of range (${r.confidence}); matches no known rule.`,
      checks,
    );
  }

  // All checks pass.
  return {
    verdict: "pass",
    reason_code: null,
    status: "ok",
    notes: "All verifier checks passed.",
    checks,
  };
}

function fail(
  code: ReasonCode,
  status: VerifierOutput["status"],
  notes: string,
  checks: VerifierOutput["checks"],
): VerifierOutput {
  return { verdict: "fail", reason_code: code, status, notes, checks };
}

/** Build the verifier trace span. */
export function verifierSpan(out: VerifierOutput, latencyMs = 5): AgentSpan {
  return {
    agent: "verifier",
    model: null,
    prompt_version: "verifier-v1",
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    latency_ms: latencyMs,
    retries: 0,
    transcript_hash: null,
    status: out.status,
    verdict: out.verdict as VerifierVerdict,
    note: out.notes,
  };
}

export { isValidWorkerResponse };

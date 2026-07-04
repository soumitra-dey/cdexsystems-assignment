import type { CanonicalRecord, ReasonCode, AgentSpan } from "../types.ts";
import type { OrchestratorInput, OrchestratorOutput } from "./contracts.ts";
import { detectInjection } from "../utils/injection.ts";
import { isOutlier, type Fence } from "../utils/stats.ts";
import { nowIso } from "../utils/clock.ts";

/**
 * Orchestrator / Planner agent. Owns the run: detects DATA-layer exceptions
 * (STALE / MISSING_INPUT / OUTLIER / INJECTION_BLOCKED), notes auto-resolved
 * Class-B drift, enforces per-record cost + step budgets, and routes each
 * record to the Worker or the exception queue. No business logic buried here —
 * it delegates assembly to the Worker and validation to the Verifier.
 */

/** Batch-level: detect SUPERSEDED_VERSION (same id => keep latest, mark older). */
export function detectSuperseded(records: CanonicalRecord[]): {
  winners: CanonicalRecord[];
  superseded: CanonicalRecord[];
} {
  const byId = new Map<string, CanonicalRecord[]>();
  for (const r of records) {
    const list = byId.get(r.id) ?? [];
    list.push(r);
    byId.set(r.id, list);
  }
  const winners: CanonicalRecord[] = [];
  const superseded: CanonicalRecord[] = [];
  for (const list of byId.values()) {
    if (list.length === 1) {
      winners.push(list[0]);
    } else {
      // Highest version wins; ties broken by source order (later wins).
      const sorted = [...list].sort(
        (a, b) => b.version - a.version || b.source_index - a.source_index,
      );
      winners.push(sorted[0]);
      for (const r of sorted.slice(1)) superseded.push(r);
    }
  }
  return { winners, superseded };
}

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const d = new Date(s + (s.length === 10 ? "T00:00:00.000Z" : ""));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function isStale(deadline: string | null, pipelineNow: string): boolean {
  const d = parseDate(deadline);
  const now = parseDate(pipelineNow);
  if (d === null || now === null) return false;
  return d < now;
}

function missingRequired(record: CanonicalRecord): string | null {
  if (record.owner === null) return "owner";
  if (record.deadline === null) return "deadline";
  if (record.amount === null) return "amount";
  return null;
}

/** Per-record routing decision (data-layer exceptions). */
export function route(input: OrchestratorInput): OrchestratorOutput {
  const { record, fence, pipelineNow, maxCostUsdPerRecord, maxStepsPerRecord } =
    input;
  const schemaDrift = record.drifts.length > 0;

  // Safety-first ordering: injection > missing > stale > outlier.
  const inj = detectInjection(record.notes);
  if (inj.blocked) {
    return except(
      "INJECTION_BLOCKED",
      "A",
      `injection phrase: "${inj.matchedPattern}"`,
      schemaDrift,
    );
  }
  const missing = missingRequired(record);
  if (missing) {
    return except(
      "MISSING_INPUT",
      "A",
      `required field null: ${missing}`,
      schemaDrift,
    );
  }
  if (isStale(record.deadline, pipelineNow)) {
    return except(
      "STALE",
      "A",
      `deadline ${record.deadline} < now ${pipelineNow}`,
      schemaDrift,
    );
  }
  if (isOutlier(record.amount, fence as Fence)) {
    return except(
      "OUTLIER",
      "A",
      `amount ${record.amount} outside IQR fence (high=${fence.high})`,
      schemaDrift,
    );
  }

  return {
    decision: "route_to_worker",
    reason_code: schemaDrift ? "SCHEMA_DRIFT" : null,
    reason_class: schemaDrift ? "B" : null,
    assigned_to: "worker",
    cost_budget: maxCostUsdPerRecord,
    step_budget: maxStepsPerRecord,
    schema_drift: schemaDrift,
    notes: schemaDrift
      ? `field rename: ${record.drifts.map((d) => d.source_key + "->" + d.canonical).join(", ")}`
      : "clean",
  };
}

function except(
  code: ReasonCode,
  cls: "A" | "B",
  notes: string,
  schemaDrift: boolean,
): OrchestratorOutput {
  return {
    decision: "route_to_exception",
    reason_code: code,
    reason_class: cls,
    assigned_to: null,
    cost_budget: 0,
    step_budget: 0,
    schema_drift: schemaDrift,
    notes,
  };
}

/** Build the orchestrator trace span for a routing decision. */
export function orchestratorSpan(
  decision: OrchestratorOutput,
  latencyMs: number,
): AgentSpan {
  return {
    agent: "orchestrator",
    model: null,
    prompt_version: "orchestrator-v1",
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    latency_ms: latencyMs,
    retries: 0,
    transcript_hash: null,
    status: decision.decision === "route_to_worker" ? "ok" : "routed",
    verdict: null,
    note: decision.notes,
  };
}

export { isStale, missingRequired, parseDate };

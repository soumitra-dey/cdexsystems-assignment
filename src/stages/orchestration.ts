import type { CanonicalRecord } from "../types.ts";
import type { ProcRecord } from "./state.ts";
import {
  detectSuperseded,
  route,
  orchestratorSpan,
} from "../agents/orchestrator.ts";
import { buildFence, type Fence } from "../utils/stats.ts";
import { nowIso } from "../utils/clock.ts";
import type { EventLog } from "../utils/eventlog.ts";
import { info } from "../utils/log.ts";

export interface OrchestrationResult {
  proc: ProcRecord[];
  fence: Fence;
  supersededIds: string[];
}

/**
 * Stage 2 — Orchestration. Detect SUPERSEDED_VERSION at batch level, build the
 * robust IQR fence from the surviving records' primary numeric field, then route
 * each record (data-layer exceptions vs. route_to_worker). Class-A exceptions do
 * NOT proceed to Assembly. SCHEMA_DRIFT is noted (Class B) but proceeds.
 */
export function runOrchestration(
  records: CanonicalRecord[],
  ctx: {
    pipelineNow: string;
    maxCostUsdPerRecord: number;
    maxStepsPerRecord: number;
  },
  log: EventLog,
): OrchestrationResult {
  const { winners, superseded } = detectSuperseded(records);
  for (const s of superseded) {
    log.append("orchestrator", "superseded_detected", s.id);
  }

  const fence = buildFence(
    winners
      .map((r) => r.amount)
      .filter((a): a is number => typeof a === "number"),
    3,
  );
  info(
    `orchestration: IQR fence(k=3) high=${fence.high} low=${fence.low} median=${fence.median}`,
  );

  const proc: ProcRecord[] = [];
  const seenIds = new Map<string, CanonicalRecord[]>();

  // Superseded records: status=superseded, minimal trace.
  for (const r of superseded) {
    const span = orchestratorSpan(
      {
        decision: "route_to_exception",
        reason_code: "SUPERSEDED_VERSION",
        reason_class: "B",
        assigned_to: null,
        cost_budget: 0,
        step_budget: 0,
        schema_drift: false,
        notes: `superseded by newer version`,
      },
      1,
    );
    log.append("orchestrator", "route_superseded", r.id);
    proc.push({
      canonical: r,
      route: {
        decision: "route_to_exception",
        reason_code: "SUPERSEDED_VERSION",
        reason_class: "B",
        assigned_to: null,
        cost_budget: 0,
        step_budget: 0,
        schema_drift: false,
        notes: "superseded by newer version",
      },
      agent_trace: [span],
      approval_trail: [{ state: "draft", actor: "orchestrator", ts: nowIso() }],
      status: "superseded",
      reason_code: "SUPERSEDED_VERSION",
      reason_class: "B",
      delivered_fields: null,
      delivered_fields_hash: null,
      transcript_hash: null,
      notes: "superseded by newer version",
    });
  }

  // Winners: route each. (Deterministic latency — rule-based, sub-millisecond.)
  for (const r of winners) {
    const decision = route({
      record: r,
      fence,
      pipelineNow: ctx.pipelineNow,
      maxCostUsdPerRecord: ctx.maxCostUsdPerRecord,
      maxStepsPerRecord: ctx.maxStepsPerRecord,
      seenIds,
    });
    const span = orchestratorSpan(decision, 1);

    if (decision.decision === "route_to_exception") {
      log.append(
        "orchestrator",
        `route_exception:${decision.reason_code}`,
        r.id,
      );
      proc.push({
        canonical: r,
        route: decision,
        agent_trace: [span],
        approval_trail: [
          {
            state: "blocked",
            actor: "orchestrator",
            ts: nowIso(),
            reason: decision.reason_code ?? undefined,
          },
        ],
        status: "exception",
        reason_code: decision.reason_code,
        reason_class: decision.reason_class,
        delivered_fields: null,
        delivered_fields_hash: null,
        transcript_hash: null,
        notes: decision.notes,
      });
    } else {
      log.append(
        "orchestrator",
        decision.schema_drift ? "route_worker:schema_drift" : "route_worker",
        r.id,
      );
      proc.push({
        canonical: r,
        route: decision,
        agent_trace: [span],
        approval_trail: [
          { state: "draft", actor: "orchestrator", ts: nowIso() },
        ],
        status: "delivered", // provisional; assembly/review may downgrade
        reason_code: decision.reason_code, // SCHEMA_DRIFT for Class B, else null
        reason_class: decision.reason_class,
        delivered_fields: null,
        delivered_fields_hash: null,
        transcript_hash: null,
        notes: decision.notes,
      });
    }
  }

  return { proc, fence, supersededIds: superseded.map((s) => s.id) };
}

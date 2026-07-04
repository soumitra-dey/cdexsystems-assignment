import type { ProcRecord } from "./state.ts";
import {
  runWorker,
  workerSpan,
  isValidWorkerResponse,
} from "../agents/worker.ts";
import { verify, verifierSpan } from "../agents/verifier.ts";
import { routeModel, type RouterContext } from "../agents/router.ts";
import { nowIso } from "../utils/clock.ts";
import type { EventLog } from "../utils/eventlog.ts";
import { info, warn } from "../utils/log.ts";

export interface AssemblyCtx {
  replay: boolean;
  transcriptsDir: string;
  maxCostUsdPerRecord: number;
  maxStepsPerRecord: number;
  amendmentThreshold: number;
  /** Probe hooks (used by probe CLIs, not the main demo). */
  inject?: { id: string; response: unknown };
  forceLoops?: { id: string; loops: number };
  forceBudgetOverrun?: { id: string };
}

/**
 * Stage 3 — Assembly. For each record routed to the Worker: the model router
 * picks cheap vs strong, the Worker drafts a structured/branded output (LLM
 * call recorded to transcripts/), then the Verifier independently checks it.
 * Verifier can OVERRULE the Worker. Abstains => LOW_CONFIDENCE exception;
 * agent failures (hallucination/malformed/loop/budget) => exception, never
 * delivered.
 */
export async function runAssembly(
  proc: ProcRecord[],
  ctx: AssemblyCtx,
  log: EventLog,
): Promise<void> {
  for (const p of proc) {
    if (p.route.decision !== "route_to_worker") continue;
    const r = p.canonical;

    const routerCtx: RouterContext = {
      schemaDrift: p.route.schema_drift,
      amount: r.amount,
      amendmentThreshold: ctx.amendmentThreshold,
      verifierFlagged: false,
      notesComplex: (r.notes?.length ?? 0) > 100,
    };
    const model = routeModel(routerCtx);

    const isInject = ctx.inject && ctx.inject.id === r.id;
    const isLoop = ctx.forceLoops && ctx.forceLoops.id === r.id;
    const isBudgetOver =
      ctx.forceBudgetOverrun && ctx.forceBudgetOverrun.id === r.id;

    const start = Date.now();
    const workerOut = await runWorker({
      record: r,
      model,
      promptVersion: "worker-v1",
      costBudget: ctx.maxCostUsdPerRecord,
      stepBudget: ctx.maxStepsPerRecord,
      replay: ctx.replay,
      transcriptsDir: ctx.transcriptsDir,
      injectResponse: isInject ? ctx.inject!.response : undefined,
      forceLoops: isLoop ? ctx.forceLoops!.loops : undefined,
    });
    p.worker = workerOut;
    p.agent_trace.push(
      workerSpan(workerOut, workerOut.abstain ? "abstained" : "ok"),
    );

    // Cost/step accounting for the Verifier's budget checks.
    const costSoFar = isBudgetOver
      ? ctx.maxCostUsdPerRecord + 1
      : workerOut.cost_usd;
    const stepsSoFar = workerOut.steps;

    const v = verify({
      record: r,
      worker: workerOut,
      stepBudget: ctx.maxStepsPerRecord,
      costBudget: ctx.maxCostUsdPerRecord,
      stepsSoFar,
      costSoFar,
    });
    p.verifier = v;
    p.agent_trace.push(verifierSpan(v, 5));

    if (v.verdict === "pass") {
      p.delivered_fields = workerOut.delivered_fields as unknown as Record<
        string,
        unknown
      >;
      p.delivered_fields_hash = workerOut.delivered_fields_hash;
      p.transcript_hash = workerOut.transcript_hash;
      log.append("worker", "assembly_pass", r.id);
      log.append("verifier", "verdict_pass", r.id);
    } else if (v.verdict === "needs_human" && workerOut.abstain) {
      // Legitimate abstain => LOW_CONFIDENCE exception (Class A).
      p.status = "exception";
      p.reason_code = workerOut.abstain_reason ?? "LOW_CONFIDENCE";
      p.reason_class = "A";
      p.delivered_fields = null;
      p.delivered_fields_hash = null;
      p.transcript_hash = workerOut.transcript_hash;
      p.notes = `Worker abstained (LOW_CONFIDENCE): ${workerOut.response.summary}`;
      p.approval_trail.push({
        state: "blocked",
        actor: "verifier",
        ts: nowIso(),
        reason: "LOW_CONFIDENCE",
      });
      log.append("worker", "assembly_abstain", r.id);
      log.append("verifier", "verdict_needs_human", r.id);
      info(`assembly: ${r.id} abstained (LOW_CONFIDENCE)`);
    } else {
      // Agent-layer failure (hallucination/malformed/loop/budget) => exception.
      p.status = "exception";
      p.reason_code = v.reason_code;
      p.reason_class = "A";
      p.delivered_fields = null;
      p.delivered_fields_hash = null;
      p.transcript_hash = workerOut.transcript_hash;
      p.notes = `Verifier rejected: ${v.notes}`;
      p.approval_trail.push({
        state: "blocked",
        actor: "verifier",
        ts: nowIso(),
        reason: v.reason_code ?? undefined,
      });
      log.append("worker", "assembly_fail", r.id);
      log.append("verifier", `verdict_fail:${v.reason_code}`, r.id);
      warn(
        `assembly: ${r.id} verifier REJECTED (${v.reason_code}) — ${v.notes}`,
      );
    }
  }
}

export { isValidWorkerResponse };

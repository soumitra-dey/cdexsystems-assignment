import { loadConfig, type AppConfig } from "./utils/config.ts";
import { computeAmendment, type Amendment } from "./utils/amendment.ts";
import { resetClock, nowIso } from "./utils/clock.ts";
import { EventLog } from "./utils/eventlog.ts";
import { runIntake } from "./stages/intake.ts";
import { runOrchestration } from "./stages/orchestration.ts";
import { runAssembly, type AssemblyCtx } from "./stages/assembly.ts";
import { runReview } from "./stages/review.ts";
import { runDelivery, type DeliveryResult } from "./stages/delivery.ts";
import { AGENT_ROSTER } from "./agents/contracts.ts";
import { stage, info, error } from "./utils/log.ts";
import { pathToFileURL } from "node:url";

export interface PipelineOptions {
  assembly?: Partial<AssemblyCtx>;
  /** Override the seed used (probes use synthetic seeds). */
  seedDir?: string;
  /** Override CASE_ID (probes). */
  caseId?: string;
  /** Skip clearing transcripts (probe idempotency re-run). */
  keepTranscripts?: boolean;
}

export interface PipelineResult extends DeliveryResult {
  amendment: Amendment;
  config: AppConfig;
  log: EventLog;
}

/**
 * Full 5-stage governed pipeline:
 *   Intake -> Orchestration -> Assembly (Worker+Verifier) -> Review -> Delivery
 * Offline-safe (REPLAY_LLM=true by default). Deterministic + idempotent.
 */
export async function runPipeline(
  cfgOverrides: Partial<AppConfig> = {},
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const config = loadConfig(cfgOverrides);
  const seedDir = opts.seedDir ?? config.seedDir;
  const caseId = opts.caseId ?? config.caseId;

  resetClock(config.pipelineNow);
  const log = new EventLog();
  const amendment = computeAmendment(caseId);

  console.log(
    `AMENDMENT: role=${amendment.role} threshold=${amendment.threshold}  (case_id=${caseId})`,
  );
  stage(
    `pipeline v1 starting — seed=${seedDir} replay=${config.replayLlm} case_id=${caseId}`,
  );
  log.append("orchestrator", "pipeline_start");

  // Stage 1 — Intake
  stage("Stage 1: Intake");
  const records = await runIntake(seedDir);
  log.append("orchestrator", "intake_complete", null);

  // Stage 2 — Orchestration
  stage("Stage 2: Orchestration");
  const { proc, fence } = runOrchestration(
    records,
    {
      pipelineNow: config.pipelineNow,
      maxCostUsdPerRecord: config.maxCostUsdPerRecord,
      maxStepsPerRecord: config.maxStepsPerRecord,
    },
    log,
  );
  log.append("orchestrator", "orchestration_complete", null);

  // Stage 3 — Assembly (Worker + Verifier)
  stage("Stage 3: Assembly (Worker + Verifier)");
  const assemblyCtx: AssemblyCtx = {
    replay: config.replayLlm,
    transcriptsDir: config.transcriptsDir,
    maxCostUsdPerRecord: config.maxCostUsdPerRecord,
    maxStepsPerRecord: config.maxStepsPerRecord,
    amendmentThreshold: amendment.threshold,
    ...opts.assembly,
  };
  await runAssembly(proc, assemblyCtx, log);
  log.append("orchestrator", "assembly_complete", null);

  // Stage 4 — Review (approval state machine + amendment gate)
  stage("Stage 4: Review & Approval");
  runReview(proc, amendment, log);
  log.append("orchestrator", "review_complete", null);

  // Stage 5 — Delivery + Audit
  stage("Stage 5: Delivery & Audit");
  const delivery = await runDelivery({
    proc,
    config: {
      caseId,
      seedDir,
      outDir: config.outDir,
      packageDir: config.packageDir,
      pipelineVersion: "cedx-appraisals-v1",
    },
    amendment,
    agents: AGENT_ROSTER,
    log,
  });
  log.append("orchestrator", "pipeline_complete", null);

  stage(
    `pipeline done — ${delivery.deliveredIds.length} delivered, ${delivery.exceptionIds.length} exceptions, cost=$${delivery.cost.total_usd.toFixed(6)}`,
  );
  return { ...delivery, amendment, config, log };
}

// Entry point when run directly (`npm run demo` / `make demo`).
const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  runPipeline()
    .then((r) => {
      info(
        `PASS demo: ${r.records.length} records, ${r.deliveredIds.length} delivered, case_id=${r.config.caseId}`,
      );
    })
    .catch((e) => {
      error(`pipeline failed: ${e?.stack ?? e}`);
      process.exit(1);
    });
}

export { nowIso };

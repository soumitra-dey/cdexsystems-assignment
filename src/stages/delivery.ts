import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProcRecord } from "./state.ts";
import type { AuditRecord, CostSummary, AgentRosterEntry } from "../types.ts";
import type { Amendment } from "../utils/amendment.ts";
import { sha, sha256Str, canon } from "../utils/hash.ts";
import { canDeliver, markDelivered } from "./review.ts";
import type { EventLog } from "../utils/eventlog.ts";
import { nowIso } from "../utils/clock.ts";
import { info, warn } from "../utils/log.ts";

export interface DeliveryInput {
  proc: ProcRecord[];
  config: {
    caseId: string;
    seedDir: string;
    outDir: string;
    packageDir: string;
    pipelineVersion: string;
  };
  amendment: Amendment;
  agents: AgentRosterEntry[];
  log: EventLog;
}

export interface DeliveryResult {
  audit: unknown;
  records: AuditRecord[];
  cost: CostSummary;
  outputPackageHash: string;
  deliveredIds: string[];
  exceptionIds: string[];
  packagePath: string;
}

/**
 * Stage 5 — Delivery + Audit. Finalizes records, writes the branded package,
 * computes the output_package_hash, builds the append-only audit bundle, and
 * dumps the exception queue. Delivery is refused server-side for any
 * non-approved item (the refusal is logged). Idempotent: out/ is cleared first
 * and everything is deterministic.
 */
export async function runDelivery(
  input: DeliveryInput,
): Promise<DeliveryResult> {
  const { proc, config, amendment, agents, log } = input;
  const packagePath = join(config.outDir, config.packageDir);

  // Idempotency: clear out/ so re-runs leave no stale/duplicate artifacts.
  await rm(config.outDir, { recursive: true, force: true });
  await mkdir(packagePath, { recursive: true });

  const records: AuditRecord[] = [];
  const deliveredIds: string[] = [];
  const exceptionIds: string[] = [];
  const deliveredFiles: { id: string; content: string }[] = [];

  for (const p of proc) {
    // Finalize delivered records (server-side refusal check).
    if (p.status === "delivered" && p.verifier?.verdict === "pass") {
      const ok = canDeliver(p, amendment, log);
      if (ok.allowed) {
        markDelivered(p, log);
        const fileContent = JSON.stringify(p.delivered_fields, null, 2);
        const fileRel = `${p.canonical.id}.json`;
        await writeFile(join(packagePath, fileRel), fileContent, "utf8");
        deliveredFiles.push({ id: p.canonical.id, content: fileContent });
        deliveredIds.push(p.canonical.id);
      } else {
        // Refused: downgrade to exception (never delivered unapproved).
        warn(`delivery refused: ${ok.reason}`);
        p.status = "exception";
        p.reason_code = p.reason_code ?? null;
        p.reason_class = "A";
        p.approval_trail.push({
          state: "blocked",
          actor: "delivery",
          ts: nowIso(),
          reason: ok.reason,
        });
        exceptionIds.push(p.canonical.id);
      }
    } else if (p.status === "exception") {
      exceptionIds.push(p.canonical.id);
    }

    records.push(toAuditRecord(p));
  }

  // output_package_hash: sha256 over the sorted, canonical package contents.
  const sorted = [...deliveredFiles].sort((a, b) => a.id.localeCompare(b.id));
  const packageBlob = sorted
    .map((f) => `${f.id}:${sha256Str(f.content)}`)
    .join("\n");
  const outputPackageHash = sha256Str(packageBlob);

  // Cost summary (check #12): total = sum of all trace span costs.
  let totalCost = 0;
  const perRecordLatency: number[] = [];
  for (const p of proc) {
    let recCost = 0;
    let recLat = 0;
    for (const s of p.agent_trace) {
      if (typeof s.cost_usd === "number") recCost += s.cost_usd;
      if (typeof s.latency_ms === "number") recLat += s.latency_ms;
    }
    totalCost += recCost;
    perRecordLatency.push(recLat);
  }
  totalCost = Math.round(totalCost * 1e6) / 1e6;
  const recordCount = records.length;
  const avg = recordCount > 0 ? totalCost / recordCount : 0;
  const p95 = p95Latency(perRecordLatency);
  const cost: CostSummary = {
    total_usd: totalCost,
    avg_usd_per_record: Math.round(avg * 1e6) / 1e6,
    p95_latency_ms: p95,
    records: recordCount,
    projected_usd_per_10k: Math.round(avg * 10000 * 1e6) / 1e6,
  };

  const audit = {
    case_id: config.caseId,
    pipeline_version: config.pipelineVersion,
    generated_at: nowIso(),
    seed_dir: config.seedDir,
    pipeline_now: process.env.PIPELINE_NOW ?? "2026-06-26",
    amendment: {
      role: amendment.role,
      threshold: amendment.threshold,
      case_id: amendment.case_id,
      hash: amendment.hash,
    },
    agents,
    cost,
    output_package_hash: outputPackageHash,
    records,
    events: log.all(),
  };

  // Write audit.json + exception_queue.json.
  await mkdir(config.outDir, { recursive: true });
  await writeFile(
    join(config.outDir, "audit.json"),
    JSON.stringify(audit, null, 2),
    "utf8",
  );

  const exceptionQueue = records
    .filter((r) => r.status === "exception")
    .map((r) => ({
      id: r.id,
      status: r.status,
      reason_code: r.reason_code,
      reason_class: r.reason_class,
      source_format: r.source_format,
      notes: proc.find((p) => p.canonical.id === r.id)?.notes ?? null,
    }));
  await writeFile(
    join(config.outDir, "exception_queue.json"),
    JSON.stringify(exceptionQueue, null, 2),
    "utf8",
  );

  info(
    `delivery: ${deliveredIds.length} delivered, ${exceptionIds.length} exceptions, ${records.length - deliveredIds.length - exceptionIds.length} superseded`,
  );
  info(
    `delivery: output_package_hash=${outputPackageHash.slice(0, 24)}... total_cost=$${totalCost.toFixed(6)}`,
  );

  return {
    audit,
    records,
    cost,
    outputPackageHash,
    deliveredIds,
    exceptionIds,
    packagePath,
  };
}

function toAuditRecord(p: ProcRecord): AuditRecord {
  return {
    id: p.canonical.id,
    version: p.canonical.version,
    source_format: p.canonical.source_format,
    source_version_hash: p.canonical.source_version_hash,
    status: p.status,
    reason_code: p.reason_code,
    reason_class: p.reason_class,
    transcript_hash: p.transcript_hash,
    delivered_fields: p.delivered_fields,
    delivered_fields_hash: p.delivered_fields_hash,
    agent_trace: p.agent_trace,
    approval_trail: p.approval_trail,
    notes: p.notes,
  };
}

function p95Latency(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor(Math.ceil(0.95 * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

export { sha, canon };

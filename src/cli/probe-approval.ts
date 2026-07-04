import { runPipeline } from "../pipeline.ts";
import { computeAmendment } from "../utils/amendment.ts";
import { canDeliver } from "../stages/review.ts";
import { EventLog } from "../utils/eventlog.ts";
import { resetClock } from "../utils/clock.ts";
import type { ProcRecord } from "../stages/state.ts";
import type { CanonicalRecord } from "../types.ts";

/**
 * PROBE: probe-approval. Exit 0 ONLY if delivery of a NON-approved item —
 * including one missing the CASE_ID amendment-role approval — is refused AND
 * the refusal is logged. Exercises the server-side refusal in canDeliver().
 */
function makeRecord(id: string, amount: number | null): ProcRecord {
  const canonical: CanonicalRecord = {
    id,
    owner: "x.test",
    deadline: "2026-08-01",
    amount,
    category: "REPORT",
    notes: "probe record",
    version: 1,
    source_format: "feed",
    source_file: "probe.json",
    source_index: 0,
    source_version_hash: "sha256:probe",
    payload: {},
    drifts: [],
    raw: {},
  };
  return {
    canonical,
    route: {
      decision: "route_to_worker",
      reason_code: null,
      reason_class: null,
      assigned_to: "worker",
      cost_budget: 0.1,
      step_budget: 5,
      schema_drift: false,
      notes: "clean",
    },
    agent_trace: [],
    approval_trail: [],
    status: "delivered",
    reason_code: null,
    reason_class: null,
    delivered_fields: null,
    delivered_fields_hash: null,
    transcript_hash: null,
    notes: "probe",
  };
}

async function main() {
  resetClock("2026-06-26");
  const amendment = computeAmendment("CEDX-33ACA8");
  const log = new EventLog();
  let ok = true;

  // (a) Non-approved item (no 'approved' state at all) => must be refused.
  const a = makeRecord("PROBE-A", 5000);
  const ra = canDeliver(a, amendment, log);
  const aRefused = !ra.allowed;
  const aLogged = log.all().some((e) => e.action.includes("delivery_refused"));
  console.log(
    `(a) non-approved: refused=${aRefused} logged=${aLogged} — ${ra.allowed ? "ALLOWED(BAD)" : ra.reason}`,
  );
  ok = ok && aRefused && aLogged;

  // (b) Approved by operator but missing amendment-role approval (amount >= T).
  const b = makeRecord("PROBE-B", amendment.threshold + 1000);
  b.approval_trail.push({
    state: "in_review",
    actor: "orchestrator",
    ts: "2026-06-26T00:00:00.000Z",
  });
  b.approval_trail.push({
    state: "approved",
    actor: "operator",
    ts: "2026-06-26T00:00:00.001Z",
  });
  const rb = canDeliver(b, amendment, log);
  const bRefused = !rb.allowed && rb.reason.includes(amendment.role);
  const bLogged = log
    .all()
    .some((e) => e.action.includes(`amendment:${amendment.role}`));
  console.log(
    `(b) missing ${amendment.role} approval (amount $${b.canonical.amount} >= $${amendment.threshold}): refused=${bRefused} logged=${bLogged} — ${rb.allowed ? "ALLOWED(BAD)" : rb.reason}`,
  );
  ok = ok && bRefused && bLogged;

  // (c) Control: approved by operator AND amendment role => allowed.
  const c = makeRecord("PROBE-C", amendment.threshold + 1000);
  c.approval_trail.push({
    state: "in_review",
    actor: "orchestrator",
    ts: "2026-06-26T00:00:00.000Z",
  });
  c.approval_trail.push({
    state: "approved",
    actor: "operator",
    ts: "2026-06-26T00:00:00.001Z",
  });
  c.approval_trail.push({
    state: "approved",
    actor: amendment.role,
    ts: "2026-06-26T00:00:00.002Z",
  });
  const rc = canDeliver(c, amendment, log);
  console.log(`(c) control (both approvals): allowed=${rc.allowed}`);
  ok = ok && rc.allowed;

  // (d) End-to-end: the real demo pipeline never delivers an unapproved record.
  const res = await runPipeline({
    outDir: "out-probe-approval",
    transcriptsDir: "transcripts-probe",
  });
  const undeliveredUnapproved = res.records.filter(
    (r) =>
      r.status === "delivered" &&
      !r.approval_trail.some((t) => t.state === "approved"),
  );
  console.log(
    `(d) end-to-end: delivered-without-approval count=${undeliveredUnapproved.length}`,
  );
  ok = ok && undeliveredUnapproved.length === 0;

  console.log(ok ? "PROBE probe-approval: PASS" : "PROBE probe-approval: FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe-approval error:", e);
  process.exit(1);
});

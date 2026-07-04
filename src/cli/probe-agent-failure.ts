import { runPipeline } from "../pipeline.ts";
import { readFileSync } from "node:fs";

/**
 * PROBE: probe-agent-failure. Exit 0 ONLY if a hallucinated / malformed /
 * looping Worker output is caught by the Verifier and routed — never delivered.
 * Covers AGENT_HALLUCINATION, AGENT_MALFORMED, AGENT_LOOP (check #15).
 */

const HALLUCINATED = {
  record_id: "REC-001",
  owner: "FAKE.OWNER",
  appraised_value: 999999,
  category: "ONBOARDING",
  deadline: "2026-07-15",
  summary: "hallucinated appraisal",
  confidence: 0.9,
  abstain: false,
  abstain_reason: null,
  schema_drift: false,
};
const MALFORMED = { foo: "bar", partial: true };

function loadAudit(dir: string): any {
  return JSON.parse(readFileSync(`${dir}/audit.json`, "utf8"));
}

function checkRec(
  audit: any,
  id: string,
  expectCode: string,
): { pass: boolean; detail: string } {
  const rec = (audit.records ?? []).find((r: any) => r.id === id);
  if (!rec) return { pass: false, detail: `${id} not found` };
  const statusOk = rec.status === "exception";
  const codeOk = rec.reason_code === expectCode;
  const notDelivered = rec.status !== "delivered";
  const verifierActs = (rec.agent_trace ?? []).filter(
    (s: any) => s.agent === "verifier",
  );
  const verifierRejected = verifierActs.some(
    (s: any) =>
      ["rejected", "overruled", "routed", "killed"].includes(s.status) ||
      s.verdict === "fail",
  );
  const pass = statusOk && codeOk && notDelivered && verifierRejected;
  return {
    pass,
    detail: `status=${rec.status} reason=${rec.reason_code} verifier_statuses=[${verifierActs.map((s: any) => s.status + (s.verdict ? "/" + s.verdict : "")).join(",")}]`,
  };
}

async function main() {
  let ok = true;

  // (1) AGENT_HALLUCINATION
  const r1 = await runPipeline(
    { outDir: "out-probe-hall", transcriptsDir: "transcripts-probe" },
    { assembly: { inject: { id: "REC-001", response: HALLUCINATED } } },
  );
  const c1 = checkRec(
    loadAudit("out-probe-hall"),
    "REC-001",
    "AGENT_HALLUCINATION",
  );
  console.log(`(1) hallucination: pass=${c1.pass} — ${c1.detail}`);
  ok = ok && c1.pass;

  // (2) AGENT_MALFORMED
  const r2 = await runPipeline(
    { outDir: "out-probe-malf", transcriptsDir: "transcripts-probe" },
    { assembly: { inject: { id: "REC-001", response: MALFORMED } } },
  );
  const c2 = checkRec(
    loadAudit("out-probe-malf"),
    "REC-001",
    "AGENT_MALFORMED",
  );
  console.log(`(2) malformed: pass=${c2.pass} — ${c2.detail}`);
  ok = ok && c2.pass;

  // (3) AGENT_LOOP (step budget exceeded)
  const r3 = await runPipeline(
    { outDir: "out-probe-loop", transcriptsDir: "transcripts-probe" },
    { assembly: { forceLoops: { id: "REC-001", loops: 999 } } },
  );
  const c3 = checkRec(loadAudit("out-probe-loop"), "REC-001", "AGENT_LOOP");
  console.log(`(3) loop: pass=${c3.pass} — ${c3.detail}`);
  ok = ok && c3.pass;

  // (4) Verify none of the failed records were delivered in any probe run.
  const noDeliver = [r1, r2, r3].every(
    (r) => !r.deliveredIds.includes("REC-001"),
  );
  console.log(`(4) never delivered: ${noDeliver}`);
  ok = ok && noDeliver;

  console.log(
    ok ? "PROBE probe-agent-failure: PASS" : "PROBE probe-agent-failure: FAIL",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe-agent-failure error:", e);
  process.exit(1);
});

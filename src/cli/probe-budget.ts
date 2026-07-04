import { runPipeline } from "../pipeline.ts";
import { readFileSync } from "node:fs";

/**
 * PROBE: probe-budget. Exit 0 ONLY if a record exceeding the per-record cost
 * ceiling raises BUDGET_EXCEEDED and is downgraded/routed — never silently
 * overspent (check #15). Uses the forceBudgetOverrun hook to push the running
 * cost past MAX_COST_USD_PER_RECORD; the Verifier must catch it.
 */

function loadAudit(dir: string): any {
  return JSON.parse(readFileSync(`${dir}/audit.json`, "utf8"));
}

async function main() {
  const res = await runPipeline(
    {
      outDir: "out-probe-budget",
      transcriptsDir: "transcripts-probe",
      maxCostUsdPerRecord: 0.1,
    },
    { assembly: { forceBudgetOverrun: { id: "REC-001" } } },
  );

  const audit = loadAudit("out-probe-budget");
  const rec = (audit.records ?? []).find((r: any) => r.id === "REC-001");
  let ok = true;

  const statusOk = rec?.status === "exception";
  const codeOk = rec?.reason_code === "BUDGET_EXCEEDED";
  const notDelivered = !res.deliveredIds.includes("REC-001");
  const verifierRouted = (rec?.agent_trace ?? []).some(
    (s: any) =>
      s.agent === "verifier" && (s.status === "routed" || s.verdict === "fail"),
  );
  const amended = audit.amendment?.role && audit.amendment?.threshold; // pipeline still healthy

  ok = statusOk && codeOk && notDelivered && verifierRouted;
  console.log(
    `status=${rec?.status} reason=${rec?.reason_code} not_delivered=${notDelivered} verifier_routed=${verifierRouted} amendment=${amended ? "present" : "MISSING"}`,
  );

  // Also: with a tight ceiling, even a normal record should be catchable if it overruns.
  const tightRes = await runPipeline({
    outDir: "out-probe-budget-tight",
    transcriptsDir: "transcripts-probe",
    maxCostUsdPerRecord: 0.000001,
  });
  // With an absurdly tight ceiling, the strong-model record (REC-016 drift) should overrun.
  const tightAudit = loadAudit("out-probe-budget-tight");
  const budgetExcs = (tightAudit.records ?? []).filter(
    (r: any) => r.reason_code === "BUDGET_EXCEEDED",
  );
  console.log(
    `tight-ceiling: BUDGET_EXCEEDED exceptions=${budgetExcs.length} (downgraded, not overspent)`,
  );
  ok =
    ok &&
    budgetExcs.length > 0 &&
    budgetExcs.every((r: any) => r.status === "exception");

  console.log(ok ? "PROBE probe-budget: PASS" : "PROBE probe-budget: FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe-budget error:", e);
  process.exit(1);
});

import { runPipeline } from "../pipeline.ts";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { EventLog } from "../utils/eventlog.ts";

/**
 * PROBE: probe-append-only. Exit 0 ONLY if mutating/deleting a past audit
 * entry is refused — both by the EventLog (programmatic refusal) AND by the
 * verify_audit.py gate (tampered seq -> FAIL). Demonstrates append-only shape.
 */

function runVerify(auditPath: string): number {
  try {
    execSync(
      `python3 verify_audit.py --audit ${auditPath} --transcripts transcripts --schema audit.schema.json`,
      {
        stdio: "pipe",
      },
    );
    return 0;
  } catch (e: any) {
    return e.status ?? 1;
  }
}

async function main() {
  await runPipeline({
    outDir: "out-probe-ao",
    transcriptsDir: "transcripts-probe",
  });
  const auditPath = "out-probe-ao/audit.json";
  const audit = JSON.parse(readFileSync(auditPath, "utf8")) as any;
  const events: any[] = audit.events ?? [];
  let ok = true;

  // (1) On-disk seq is strictly 0..n-1 (append-only shape intact).
  const seqs = events.map((e) => e.seq);
  const intact = seqs.length > 0 && seqs.every((s, i) => s === i);
  console.log(`(1) on-disk seq 0..${seqs.length - 1} intact: ${intact}`);
  ok = ok && intact;

  // (2) Programmatic refusal to mutate/delete past entries.
  const log = new EventLog();
  for (const e of events) (log as any).append(e.actor, e.action, e.record_id);
  const mut = log.mutate(0);
  const del = log.delete(0);
  console.log(
    `(2) mutate(0) refused=${mut.refused}  delete(0) refused=${del.refused}`,
  );
  ok = ok && mut.refused && del.refused;

  // (3) Tampered seq (rewrite event 5's seq to 999) -> verify_audit.py FAIL.
  const tamperedSeq = JSON.parse(JSON.stringify(audit));
  if (tamperedSeq.events.length > 5) tamperedSeq.events[5].seq = 999;
  writeFileSync(
    "out-probe-ao/tampered_seq.json",
    JSON.stringify(tamperedSeq, null, 2),
  );
  const rcSeq = runVerify("out-probe-ao/tampered_seq.json");
  console.log(`(3) tampered seq -> verify exit=${rcSeq} (expect non-zero)`);
  ok = ok && rcSeq !== 0;

  // (4) Deleted event (gap in seq) -> verify_audit.py FAIL.
  const tamperedDel = JSON.parse(JSON.stringify(audit));
  tamperedDel.events.splice(3, 1); // create a gap
  writeFileSync(
    "out-probe-ao/tampered_del.json",
    JSON.stringify(tamperedDel, null, 2),
  );
  const rcDel = runVerify("out-probe-ao/tampered_del.json");
  console.log(`(4) deleted event -> verify exit=${rcDel} (expect non-zero)`);
  ok = ok && rcDel !== 0;

  // (5) Untouched audit still verifies (sanity).
  const rcOk = runVerify(auditPath);
  console.log(`(5) untouched audit -> verify exit=${rcOk} (expect 0)`);
  ok = ok && rcOk === 0;

  rmSync("out-probe-ao/tampered_seq.json", { force: true });
  rmSync("out-probe-ao/tampered_del.json", { force: true });

  console.log(
    ok ? "PROBE probe-append-only: PASS" : "PROBE probe-append-only: FAIL",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe-append-only error:", e);
  process.exit(1);
});

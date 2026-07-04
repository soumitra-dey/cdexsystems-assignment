import { runPipeline } from "../pipeline.ts";
import { readFileSync, readdirSync } from "node:fs";

/**
 * PROBE: probe-idempotency. Exit 0 ONLY if running the demo twice produces no
 * duplicate outputs / exceptions / approvals. Because the pipeline is fully
 * deterministic (deterministic clock + replay-mode Worker), the two runs must
 * produce BYTE-IDENTICAL audit.json + exception_queue.json and the same
 * delivered-package file set.
 */

async function main() {
  const r1 = await runPipeline({
    outDir: "out",
    transcriptsDir: "transcripts",
  });
  const audit1 = readFileSync("out/audit.json", "utf8");
  const exc1 = readFileSync("out/exception_queue.json", "utf8");
  const pkg1 = new Set(readdirSync("out/cedx-appraisals").sort());

  const r2 = await runPipeline({
    outDir: "out",
    transcriptsDir: "transcripts",
  });
  const audit2 = readFileSync("out/audit.json", "utf8");
  const exc2 = readFileSync("out/exception_queue.json", "utf8");
  const pkg2 = new Set(readdirSync("out/cedx-appraisals").sort());

  let ok = true;

  // (1) Byte-identical audit bundle (deterministic).
  const auditIdentical = audit1 === audit2;
  console.log(`(1) audit.json byte-identical across runs: ${auditIdentical}`);
  ok = ok && auditIdentical;

  // (2) Byte-identical exception queue.
  const excIdentical = exc1 === exc2;
  console.log(`(2) exception_queue.json byte-identical: ${excIdentical}`);
  ok = ok && excIdentical;

  // (3) No duplicate record IDs in the audit.
  const ids = r2.records.map((r) => `${r.id}@v${r.version}`);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  console.log(
    `(3) duplicate record IDs: ${dup.length === 0 ? "none" : dup.join(",")}`,
  );
  ok = ok && dup.length === 0;

  // (4) No duplicate delivered files / exceptions between runs (same set).
  const pkgSame =
    pkg1.size === pkg2.size && [...pkg1].every((f) => pkg2.has(f));
  console.log(
    `(4) delivered package set stable: ${pkgSame} (${pkg2.size} files)`,
  );
  ok = ok && pkgSame;

  // (5) Delivered + exception counts match (no drift).
  const countsStable =
    r1.deliveredIds.length === r2.deliveredIds.length &&
    r1.exceptionIds.length === r2.exceptionIds.length;
  console.log(
    `(5) counts stable: delivered=${r1.deliveredIds.length}/${r2.deliveredIds.length} exceptions=${r1.exceptionIds.length}/${r2.exceptionIds.length}`,
  );
  ok = ok && countsStable;

  console.log(
    ok ? "PROBE probe-idempotency: PASS" : "PROBE probe-idempotency: FAIL",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe-idempotency error:", e);
  process.exit(1);
});

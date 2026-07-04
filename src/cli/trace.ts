import { readFileSync } from "node:fs";
import { join } from "node:path";

const ID = process.env.ID ?? process.argv[2] ?? "";
if (!ID) {
  console.error(
    "usage: make trace ID=<id>  (or: npx tsx src/cli/trace.ts <id>)",
  );
  process.exit(2);
}

const auditPath = process.env.AUDIT ?? "out/audit.json";
const audit = JSON.parse(readFileSync(auditPath, "utf8")) as any;
const rec =
  (audit.records ?? []).find(
    (r: any) => r.id === ID && r.status !== "superseded",
  ) ?? (audit.records ?? []).find((r: any) => r.id === ID);
if (!rec) {
  console.error(`record ${ID} not found in ${auditPath}`);
  process.exit(1);
}

console.log(`=== TRACE: ${rec.id} (v${rec.version}, ${rec.source_format}) ===`);
console.log(
  `status: ${rec.status}  reason: ${rec.reason_code ?? "-"}  class: ${rec.reason_class ?? "-"}`,
);
console.log(`transcript_hash: ${rec.transcript_hash ?? "-"}`);
console.log(`delivered_fields_hash: ${rec.delivered_fields_hash ?? "-"}`);
console.log("");
console.log("agent_trace:");
let i = 0;
for (const s of rec.agent_trace ?? []) {
  i++;
  const cost =
    typeof s.cost_usd === "number" ? `$${s.cost_usd.toFixed(6)}` : "-";
  const tok =
    s.tokens_in != null && s.tokens_out != null
      ? `${s.tokens_in}->${s.tokens_out}`
      : "-";
  console.log(
    `  [${i}] ${s.agent.padEnd(12)} model=${s.model ?? "-"} tokens=${tok} cost=${cost} lat=${s.latency_ms ?? "-"}ms` +
      ` retries=${s.retries ?? 0} status=${s.status}${s.verdict ? " verdict=" + s.verdict : ""}`,
  );
  if (s.note) console.log(`       note: ${s.note}`);
}
console.log("");
console.log("approval_trail:");
for (const t of rec.approval_trail ?? []) {
  console.log(
    `  ${t.state.padEnd(18)} actor=${t.actor} ts=${t.ts}${t.reason ? " reason=" + t.reason : ""}`,
  );
}
console.log("");
console.log("events:");
for (const e of audit.events ?? []) {
  if (e.record_id === rec.id)
    console.log(`  seq=${e.seq} ${e.ts} ${e.actor} ${e.action}`);
}
process.exit(0);

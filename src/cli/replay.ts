import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ID = process.env.ID ?? process.argv[2] ?? "";
if (!ID) {
  console.error("usage: make replay ID=<id>");
  process.exit(2);
}

const audit = JSON.parse(readFileSync("out/audit.json", "utf8")) as any;
const rec = (audit.records ?? []).find((r: any) => r.id === ID);
if (!rec) {
  console.error(`record ${ID} not found in audit.json`);
  process.exit(1);
}

console.log(`=== DATA LINEAGE: ${rec.id} ===`);
console.log(
  `source: ${rec.source_format}  source_version_hash: ${rec.source_version_hash}`,
);
console.log(`status: ${rec.status}  reason: ${rec.reason_code ?? "-"}`);
console.log("");

// Transcript lineage (if delivered).
if (rec.transcript_hash) {
  const stem = rec.transcript_hash.split(":")[1];
  const tdir = process.env.TRANSCRIPTS ?? "transcripts";
  let t: any = null;
  try {
    t = JSON.parse(readFileSync(join(tdir, stem + ".json"), "utf8"));
  } catch {
    /* missing */
  }
  if (t) {
    console.log("load-bearing transcript:");
    console.log(`  agent: ${t.agent}`);
    console.log(
      `  model: ${t.model}  prompt_version: ${t.prompt_version}  replay: ${t.replay}`,
    );
    console.log(`  request_hash: ${t.request_hash}`);
    console.log(
      `  response_hash: ${t.response_hash}  (filename: ${stem}.json)`,
    );
    console.log(`  delivered_fields_hash: ${t.delivered_fields_hash}`);
    console.log(
      `  tokens: ${t.tokens_in} -> ${t.tokens_out}  cost: $${t.cost_usd}  latency: ${t.latency_ms}ms`,
    );
    console.log(
      `  response.confidence: ${t.response?.confidence}  abstain: ${t.response?.abstain}`,
    );
  } else {
    console.log(`transcript ${rec.transcript_hash} NOT committed`);
  }
} else {
  console.log("no transcript (record not assembled by the Worker).");
}

console.log("");
console.log("agent decision path (from log):");
for (const s of rec.agent_trace ?? []) {
  console.log(
    `  ${s.agent}: ${s.status}${s.verdict ? " / " + s.verdict : ""}${s.note ? " — " + s.note : ""}`,
  );
}
console.log("");
console.log("event timeline:");
for (const e of audit.events ?? []) {
  if (e.record_id === rec.id)
    console.log(`  seq=${e.seq} ${e.actor} ${e.action}`);
}
process.exit(0);

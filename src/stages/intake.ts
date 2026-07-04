import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { CanonicalRecord, SourceFormat } from "../types.ts";
import { buildCanonicalRecord } from "../utils/schema.ts";
import { parseEml } from "../utils/eml.ts";
import { parsePdf } from "../utils/pdf.ts";
import { info } from "../utils/log.ts";

/**
 * Stage 1 — Intake. Parses BOTH formats (feed.json + inbox PDF/.eml) into
 * canonical records. No business logic here — just parse + persist with owner,
 * deadline, primary numeric field, notes, version. Field renames are captured
 * as drifts by buildCanonicalRecord (SCHEMA_DRIFT evidence).
 */
export async function runIntake(seedDir: string): Promise<CanonicalRecord[]> {
  const records: CanonicalRecord[] = [];

  // feed.json — structured JSON array.
  const feedPath = join(seedDir, "feed.json");
  try {
    const feed = JSON.parse(await readFile(feedPath, "utf8")) as Record<
      string,
      unknown
    >[];
    feed.forEach((raw, i) => {
      records.push(
        buildCanonicalRecord(raw, {
          source_format: "feed",
          source_file: "feed.json",
          source_index: i,
        }),
      );
    });
    info(`intake: feed.json -> ${feed.length} records`);
  } catch {
    info(`intake: no feed.json in ${seedDir}`);
  }

  // inbox/ — PDF + .eml records (some planted problems live ONLY here).
  const inbox = join(seedDir, "inbox");
  let emlCount = 0;
  let pdfCount = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(inbox);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const abs = join(inbox, entry);
    const lower = entry.toLowerCase();
    if (lower.endsWith(".eml")) {
      const raw = await parseEml(abs);
      records.push(
        buildCanonicalRecord(raw, {
          source_format: "eml",
          source_file: entry,
          source_index: records.length,
        }),
      );
      emlCount++;
    } else if (lower.endsWith(".pdf")) {
      const raw = await parsePdf(abs);
      records.push(
        buildCanonicalRecord(raw, {
          source_format: "pdf",
          source_file: entry,
          source_index: records.length,
        }),
      );
      pdfCount++;
    }
  }
  info(`intake: inbox/ -> ${emlCount} eml, ${pdfCount} pdf`);
  return records;
}

export { buildCanonicalRecord };
export type { CanonicalRecord, SourceFormat };

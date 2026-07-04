/**
 * Parse "Key: Value" pairs out of free text where fields may be concatenated
 * on one line (PDF extraction) or separated by newlines (EML body). Robust to
 * renamed fields via the alias table in schema.ts. The key list is the union of
 * all canonical fields + aliases so SCHEMA_DRIFT renames are still captured.
 */
import { CANONICAL_FIELDS, type CanonicalField } from "./schema.ts";

const ALL_KEYS = new Set<string>();
for (const aliases of Object.values(CANONICAL_FIELDS)) {
  for (const a of aliases as readonly string[]) ALL_KEYS.add(a.toLowerCase());
}
// Longest-first so e.g. "deadline" matches before "date".
const KEY_LIST = [...ALL_KEYS].sort((a, b) => b.length - a.length);
const KEY_RE = new RegExp(
  "(?:^|\\s)(" +
    KEY_LIST.map((k) => k.replace(/_/g, "[ _-]?")).join("|") +
    ")\\s*:\\s*",
  "i",
);

export function parseKeyValueText(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const matches: { key: string; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(KEY_RE, "gi");
  while ((m = re.exec(text)) !== null) {
    matches.push({ key: m[1], index: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const valueEnd =
      i + 1 < matches.length ? matches[i + 1].index : text.length;
    const raw = text.slice(matches[i].end, valueEnd).trim();
    out[matches[i].key] = raw;
  }
  return out;
}

/** Line-based "Key: Value" parser (for EML bodies where each field is its own line). */
export function parseKeyValueLines(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of body.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export { CANONICAL_FIELDS, type CanonicalField };

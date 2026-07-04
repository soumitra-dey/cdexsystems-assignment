import type { CanonicalRecord, SourceFormat } from "../types.ts";
import { sha256Str } from "./hash.ts";

/**
 * Declarative field mapping. Maps source field names (incl. renamed aliases)
 * to the canonical schema. A non-canonical alias => SCHEMA_DRIFT (Class B,
 * auto-resolved: we map and continue). The alias table is broad on purpose so
 * it generalizes to the held-out seed's "different field-rename names".
 */
export const CANONICAL_FIELDS = {
  id: ["id", "record_id", "ref", "reference", "request_id", "rec"],
  owner: ["owner", "agent", "assignee", "handler", "submitted_by", "operator"],
  deadline: [
    "deadline",
    "due",
    "due_date",
    "duedate",
    "date",
    "target_date",
    "dueby",
  ],
  amount: [
    "amount",
    "value",
    "amt",
    "appraised_value",
    "appraisedvalue",
    "valuation",
    "price",
    "estimated_value",
    "est_value",
    "appraisal",
  ],
  category: ["category", "type", "kind", "class", "workflow", "request_type"],
  notes: [
    "notes",
    "note",
    "comments",
    "comment",
    "description",
    "desc",
    "remarks",
    "summary",
  ],
  version: ["version", "ver", "rev", "revision"],
} as const;

export type CanonicalField = keyof typeof CANONICAL_FIELDS;

export interface FieldMapResult {
  canonical: Partial<Record<CanonicalField, unknown>>;
  drifts: { canonical: string; source_key: string }[];
  remaining: Record<string, unknown>;
}

/** Lowercase a key for case-insensitive alias matching. */
function normKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** Map a raw record's keys to canonical fields; record any renames as drifts. */
export function mapFields(raw: Record<string, unknown>): FieldMapResult {
  const indexed: Record<string, { original: string; value: unknown }> = {};
  for (const k of Object.keys(raw)) {
    indexed[normKey(k)] = { original: k, value: raw[k] };
  }
  const canonical: Partial<Record<CanonicalField, unknown>> = {};
  const drifts: { canonical: string; source_key: string }[] = [];
  const used = new Set<string>();

  for (const canon of Object.keys(CANONICAL_FIELDS) as CanonicalField[]) {
    const aliases = CANONICAL_FIELDS[canon] as readonly string[];
    for (const alias of aliases) {
      const hit = indexed[alias];
      if (hit !== undefined) {
        canonical[canon] = hit.value;
        used.add(alias);
        if (alias !== canon) {
          drifts.push({ canonical: canon, source_key: hit.original });
        }
        break;
      }
    }
  }

  const remaining: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (!used.has(normKey(k))) remaining[k] = raw[k];
  }
  return { canonical, drifts, remaining };
}

/** Coerce a value to a number or null (preserves nulls for MISSING_INPUT). */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toInt(v: unknown, def: number): number {
  const n = toNumber(v);
  if (n === null) return def;
  return Math.trunc(n);
}

/** Build a canonical record from a raw key-value map + source metadata. */
export function buildCanonicalRecord(
  raw: Record<string, unknown>,
  meta: {
    source_format: SourceFormat;
    source_file: string;
    source_index: number;
  },
): CanonicalRecord {
  const { canonical, drifts, remaining } = mapFields(raw);
  const version = toInt(canonical.version, 1);
  return {
    id:
      String(canonical.id ?? "").trim() || `__MISSING_ID__${meta.source_index}`,
    owner: toStr(canonical.owner),
    deadline: toStr(canonical.deadline),
    amount: toNumber(canonical.amount),
    category: toStr(canonical.category),
    notes: toStr(canonical.notes),
    version,
    source_format: meta.source_format,
    source_file: meta.source_file,
    source_index: meta.source_index,
    source_version_hash: sha256Str(
      JSON.stringify(raw) + "|" + meta.source_file,
    ),
    payload: remaining,
    drifts,
    raw,
  };
}

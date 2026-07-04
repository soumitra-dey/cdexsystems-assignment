import { createHash } from "node:crypto";

/**
 * Canonical JSON serialization that MUST match verify_audit.py's `canon(obj)`:
 *   json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=False)
 * i.e. recursively sorted keys, compact separators, non-ASCII left as-is.
 */
export function canon(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return jsonString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(codePointCompare);
    const parts = keys.map((k) => jsonString(k) + ":" + canonicalize(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return "null";
  if (Number.isInteger(n)) return n.toString();
  // Match Python repr for floats as closely as possible: use the shortest
  // round-trippable representation. JS String() already does this for IEEE754.
  return String(n);
}

// JSON string escaping matching Python json.dumps (ensure_ascii=False):
// escape ", \, and control chars; leave non-ASCII as raw UTF-8.
function jsonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 0x22)
      out += '\\"'; // "
    else if (ch === 0x5c)
      out += "\\\\"; // backslash
    else if (ch === 0x08) out += "\\b";
    else if (ch === 0x0c) out += "\\f";
    else if (ch === 0x0a) out += "\\n";
    else if (ch === 0x0d) out += "\\r";
    else if (ch === 0x09) out += "\\t";
    else if (ch < 0x20) out += "\\u" + ch.toString(16).padStart(4, "0");
    else out += s[i];
  }
  out += '"';
  return out;
}

function codePointCompare(a: string, b: string): number {
  // Python sorts dict keys by Unicode code point (for str keys). Compare by
  // UTF-16 code units, which agrees with code-point order for the BMP.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** sha256: prefix + hex digest of canon(obj) — matches verify_audit.py `sha(obj)`. */
export function sha(obj: unknown): string {
  return "sha256:" + sha256Hex(canon(obj));
}

/** Bare hex digest of canon(obj). */
export function shaHex(obj: unknown): string {
  return sha256Hex(canon(obj));
}

/** sha256 hex digest of a raw UTF-8 string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** sha256: prefix + hex digest of a raw UTF-8 string. */
export function sha256Str(input: string): string {
  return "sha256:" + sha256Hex(input);
}

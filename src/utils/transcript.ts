import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha, shaHex, sha256Str } from "./hash.ts";
import { nowIso } from "./clock.ts";

export interface TranscriptInput {
  agent: string; // which agent made the call (must be a roster agent)
  model: string;
  prompt_version: string;
  request: unknown; // canonical input to the model
  response: unknown; // raw model output (load-bearing)
  delivered_fields: object; // subset that gets delivered
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  replay: boolean;
  transcriptsDir: string;
}

export interface TranscriptResult {
  /** "sha256:<hex>" — points at transcripts/<hex>.json; equals response_hash. */
  transcript_hash: string;
  response_hash: string;
  request_hash: string;
  delivered_fields_hash: string;
  file: string;
}

/**
 * Persist a load-bearing LLM call to transcripts/<response_hash_hex>.json.
 * Filename == response_hash hex (check #8). `agent` tag recorded (check #14).
 * delivered_fields_hash stored so the verifier/audit can cross-check (check #8).
 */
export async function writeTranscript(
  t: TranscriptInput,
): Promise<TranscriptResult> {
  const request_hash = sha256Str(canonicalStr(t.request));
  const response_hash = sha(t.response);
  const delivered_fields_hash = sha(t.delivered_fields);
  const stem = response_hash.split(":")[1];

  const body = {
    agent: t.agent,
    model: t.model,
    prompt_version: t.prompt_version,
    ts: nowIso(),
    replay: t.replay,
    request: t.request,
    request_hash,
    response: t.response,
    response_hash,
    delivered_fields: t.delivered_fields,
    delivered_fields_hash,
    tokens_in: t.tokens_in,
    tokens_out: t.tokens_out,
    cost_usd: round6(t.cost_usd),
    latency_ms: t.latency_ms,
  };

  const file = join(t.transcriptsDir, stem + ".json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), "utf8");

  return {
    transcript_hash: response_hash,
    response_hash,
    request_hash,
    delivered_fields_hash,
    file,
  };
}

/** Canonical string for request hashing (sorted keys). */
function canonicalStr(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys<T>(x: T): T {
  if (Array.isArray(x)) return x.map(sortKeys) as unknown as T;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
    return out as unknown as T;
  }
  return x;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export { shaHex };

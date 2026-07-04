/**
 * Model router + cost accounting. Cheap model for easy/clean records; escalate
 * to a strong model only when a record is complex (schema drift, high-value, or
 * Verifier-flagged for retry). In REPLAY mode the "model" is a label stamped on
 * the transcript; in REAL mode it selects the actual API model. The router MUST
 * actually downgrade on easy records (graded on the held-out run).
 */

export interface ModelRate {
  name: string;
  in_per_1m: number; // USD per 1M input tokens
  out_per_1m: number; // USD per 1M output tokens
  tier: "cheap" | "strong";
}

export const MODEL_RATES: Record<string, ModelRate> = {
  "gpt-4o-mini": {
    name: "gpt-4o-mini",
    in_per_1m: 0.15,
    out_per_1m: 0.6,
    tier: "cheap",
  },
  "gpt-4o": {
    name: "gpt-4o",
    in_per_1m: 2.5,
    out_per_1m: 10.0,
    tier: "strong",
  },
  "claude-3-5-haiku": {
    name: "claude-3-5-haiku",
    in_per_1m: 0.8,
    out_per_1m: 4.0,
    tier: "cheap",
  },
  "gemini-1.5-flash": {
    name: "gemini-1.5-flash",
    in_per_1m: 0.075,
    out_per_1m: 0.3,
    tier: "cheap",
  },
};

export const CHEAP_MODEL = "gpt-4o-mini";
export const STRONG_MODEL = "gpt-4o";

export interface RouterContext {
  schemaDrift: boolean;
  amount: number | null;
  amendmentThreshold: number;
  verifierFlagged: boolean;
  notesComplex: boolean;
}

/** Pick a model. Cheap by default; escalate only on real complexity. */
export function routeModel(ctx: RouterContext): string {
  if (ctx.verifierFlagged) return STRONG_MODEL;
  if (ctx.schemaDrift) return STRONG_MODEL;
  // High-value records (>= 50% of amendment threshold) get the strong model.
  if (
    ctx.amount !== null &&
    ctx.amendmentThreshold > 0 &&
    ctx.amount >= ctx.amendmentThreshold * 0.5
  ) {
    return STRONG_MODEL;
  }
  if (ctx.notesComplex) return STRONG_MODEL;
  return CHEAP_MODEL;
}

/** Rough token estimate from a serialized payload (~4 chars/token). */
export function estimateTokens(obj: unknown): number {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  return Math.max(1, Math.ceil(s.length / 4));
}

/** USD cost for a call given model + token counts. */
export function costFor(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const r = MODEL_RATES[model] ?? MODEL_RATES[CHEAP_MODEL];
  return (tokensIn / 1e6) * r.in_per_1m + (tokensOut / 1e6) * r.out_per_1m;
}

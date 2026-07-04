import type { CanonicalRecord, ReasonCode, AgentSpan } from "../types.ts";
import type {
  WorkerInput,
  WorkerOutput,
  WorkerResponse,
  WorkerDeliveredFields,
} from "./contracts.ts";
import { writeTranscript } from "../utils/transcript.ts";
import { costFor, estimateTokens, MODEL_RATES } from "./router.ts";
import { nowIso } from "../utils/clock.ts";

/**
 * Worker agent — the LLM-heavy Assembly step. Produces a structured/branded
 * Property Appraisal output from a normalized record. Has an explicit abstain
 * path (LOW_CONFIDENCE): if the record is too ambiguous to produce a confident
 * output, it abstains rather than guessing. Every call is recorded to
 * transcripts/<response_hash>.json tagged with agent="worker" (load-bearing).
 *
 * Two execution modes:
 *  - REPLAY (default): the "LLM call" is a deterministic pure function of the
 *    input + prompt version => byte-identical transcripts on re-run (idempotent).
 *  - REAL: calls an OpenAI-compatible chat completions endpoint (LLM_API_KEY).
 */

const AMBIGUITY_RE =
  /unclear|inconsistent|not attached|tbd|could be|ambiguous|cannot determine|undetermined|side letter|figures inconsistent|indeterminate/i;

function isAmbiguous(record: CanonicalRecord): boolean {
  if (
    record.category === null ||
    record.category === "?" ||
    record.category === ""
  )
    return true;
  if (AMBIGUITY_RE.test(record.notes ?? "")) return true;
  return false;
}

/** REPLAY-mode "model": deterministic structured output simulating the LLM. */
function replayResponse(record: CanonicalRecord): WorkerResponse {
  const ambiguous = isAmbiguous(record);
  const confidence = ambiguous ? 0.3 : 0.92;
  const owner = record.owner;
  const amount = record.amount;
  const category = record.category;
  const deadline = record.deadline;
  const summary = ambiguous
    ? `Unable to produce a confident appraisal for ${record.id}: category/figures ambiguous.`
    : `Property appraisal work request for ${owner} (${category}). Appraised value $${amount}, due ${deadline}.`;
  return {
    record_id: record.id,
    owner,
    appraised_value: amount,
    category,
    deadline,
    summary,
    confidence,
    abstain: ambiguous,
    abstain_reason: ambiguous ? "LOW_CONFIDENCE" : null,
    schema_drift: record.drifts.length > 0,
  };
}

function toDeliveredFields(
  r: WorkerResponse,
  record: CanonicalRecord,
): WorkerDeliveredFields {
  return {
    record_id: r.record_id,
    owner: r.owner,
    appraised_value: r.appraised_value,
    category: r.category,
    deadline: r.deadline,
    summary: r.summary,
    confidence: r.confidence,
    source_format: record.source_format,
    schema_drift: r.schema_drift,
  };
}

/** REAL-mode: call an OpenAI-compatible endpoint with JSON mode. */
async function realLlmCall(
  prompt: string,
  model: string,
  cfg: { apiKey: string; baseUrl: string },
): Promise<WorkerResponse> {
  const url = cfg.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: WORKER_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as WorkerResponse;
}

const WORKER_SYSTEM_PROMPT = `You are a Worker agent in a Real Estate Property Appraisal pipeline. Produce a structured JSON appraisal from the given work request. If the record is too ambiguous to produce a confident output, set "abstain": true and "abstain_reason": "LOW_CONFIDENCE". Never invent fields not present in the source. Respond ONLY with JSON: {record_id, owner, appraised_value, category, deadline, summary, confidence, abstain, abstain_reason, schema_drift}.`;

function buildPrompt(record: CanonicalRecord): string {
  return JSON.stringify({
    record_id: record.id,
    owner: record.owner,
    deadline: record.deadline,
    amount: record.amount,
    category: record.category,
    notes: record.notes,
    schema_drift: record.drifts,
  });
}

/** Run the Worker on one record. */
export async function runWorker(input: WorkerInput): Promise<WorkerOutput> {
  const { record, model, promptVersion, replay, transcriptsDir } = input;
  const request = {
    record_id: record.id,
    owner: record.owner,
    deadline: record.deadline,
    amount: record.amount,
    category: record.category,
    notes: record.notes,
    schema_drift: record.drifts,
    prompt_version: promptVersion,
  };

  let response: WorkerResponse;
  let steps = 1;

  // Probe hook: inject a (bad) response to test the Verifier.
  if (input.injectResponse !== undefined) {
    response = input.injectResponse as WorkerResponse;
  } else if (input.forceLoops && input.forceLoops > 0) {
    // Probe hook: burn steps to trip AGENT_LOOP / BUDGET_EXCEEDED.
    steps = input.forceLoops;
    response = replayResponse(record);
  } else if (replay) {
    response = replayResponse(record);
  } else {
    const cfg = {
      apiKey: process.env.LLM_API_KEY ?? "",
      baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    };
    response = await realLlmCall(buildPrompt(record), model, cfg);
  }

  // Bounded retry/repair (in real mode a malformed response gets one repair).
  let retries = 0;
  if (
    !isValidWorkerResponse(response) &&
    replay === false &&
    input.injectResponse === undefined
  ) {
    retries = 1;
    response = replayResponse(record); // repair fallback
  }

  const delivered = toDeliveredFields(response, record);
  const tokens_in = estimateTokens(request);
  const tokens_out = estimateTokens(response);
  const cost_usd = costFor(model, tokens_in, tokens_out);
  const rate = MODEL_RATES[model] ?? MODEL_RATES["gpt-4o-mini"];
  const latency_ms =
    (rate.tier === "strong" ? 180 : 45) + Math.floor(tokens_out / 10);

  const t = await writeTranscript({
    agent: "worker",
    model,
    prompt_version: promptVersion,
    request,
    response,
    delivered_fields: delivered,
    tokens_in,
    tokens_out,
    cost_usd,
    latency_ms,
    replay,
    transcriptsDir,
  });

  return {
    response,
    delivered_fields: delivered,
    transcript_hash: t.transcript_hash,
    response_hash: t.response_hash,
    delivered_fields_hash: t.delivered_fields_hash,
    model,
    prompt_version: promptVersion,
    tokens_in,
    tokens_out,
    cost_usd,
    latency_ms,
    abstain: response.abstain === true,
    abstain_reason: response.abstain_reason ?? null,
    steps,
  };
}

/** Structural validation of a Worker response (used by Worker + Verifier). */
export function isValidWorkerResponse(r: unknown): r is WorkerResponse {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.record_id === "string" &&
    typeof o.summary === "string" &&
    typeof o.confidence === "number" &&
    typeof o.abstain === "boolean"
  );
}

/** Build the worker trace span. */
export function workerSpan(
  out: WorkerOutput,
  status: AgentSpan["status"] = "ok",
): AgentSpan {
  return {
    agent: "worker",
    model: out.model,
    prompt_version: out.prompt_version,
    tokens_in: out.tokens_in,
    tokens_out: out.tokens_out,
    cost_usd: out.cost_usd,
    latency_ms: out.latency_ms,
    retries: 0,
    transcript_hash: out.transcript_hash,
    status,
    verdict: null,
  };
}

export { isAmbiguous, WORKER_SYSTEM_PROMPT };
export type { ReasonCode };

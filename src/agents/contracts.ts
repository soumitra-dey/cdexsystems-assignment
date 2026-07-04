import type {
  AgentRosterEntry,
  CanonicalRecord,
  ReasonCode,
} from "../types.ts";

/**
 * Typed contracts for the agent fleet. Each agent has a declared input/output
 * schema and a `can_call` list (check #10). The Orchestrator dispatches; the
 * Worker drafts; the Verifier independently checks and can OVERRULE the Worker.
 */

export const AGENT_ROSTER: AgentRosterEntry[] = [
  {
    name: "orchestrator",
    role: "orchestrator",
    models: ["rule-based"],
    prompt_version: "orchestrator-v1",
    can_call: ["worker", "verifier"],
  },
  {
    name: "worker",
    role: "worker",
    models: ["gpt-4o-mini", "gpt-4o"],
    prompt_version: "worker-v1",
    can_call: [],
  },
  {
    name: "verifier",
    role: "verifier",
    models: ["rule-based"],
    prompt_version: "verifier-v1",
    can_call: [],
  },
];

export const AGENT_NAMES = AGENT_ROSTER.map((a) => a.name);
export const WORKER_NAMES = AGENT_ROSTER.filter((a) => a.role === "worker").map(
  (a) => a.name,
);
export const VERIFIER_NAMES = AGENT_ROSTER.filter(
  (a) => a.role === "verifier",
).map((a) => a.name);

// ---- Orchestrator contract ----
export type RouteDecision =
  "route_to_worker" | "route_to_exception" | "route_to_human";

export interface OrchestratorInput {
  record: CanonicalRecord;
  fence: {
    high: number;
    low: number;
    median: number;
    q1: number;
    q3: number;
    iqr: number;
    k: number;
  };
  pipelineNow: string;
  maxCostUsdPerRecord: number;
  maxStepsPerRecord: number;
  seenIds: Map<string, CanonicalRecord[]>; // for SUPERSEDED_VERSION (batch-level)
}

export interface OrchestratorOutput {
  decision: RouteDecision;
  reason_code: ReasonCode | null;
  reason_class: "A" | "B" | null;
  assigned_to: string | null;
  cost_budget: number;
  step_budget: number;
  schema_drift: boolean; // Class B, still proceeds
  notes: string;
}

// ---- Worker contract ----
export interface WorkerInput {
  record: CanonicalRecord;
  model: string;
  promptVersion: string;
  costBudget: number;
  stepBudget: number;
  replay: boolean;
  transcriptsDir: string;
  /** Probe hook: if set, the worker returns this exact (bad) response. */
  injectResponse?: unknown;
  /** Force the worker to loop this many times (probe). */
  forceLoops?: number;
}

export interface WorkerDeliveredFields {
  record_id: string;
  owner: string | null;
  appraised_value: number | null;
  category: string | null;
  deadline: string | null;
  summary: string;
  confidence: number;
  source_format: string;
  schema_drift: boolean;
}

export interface WorkerResponse {
  record_id: string;
  owner: string | null;
  appraised_value: number | null;
  category: string | null;
  deadline: string | null;
  summary: string;
  confidence: number;
  abstain: boolean;
  abstain_reason: ReasonCode | null;
  schema_drift: boolean;
}

export interface WorkerOutput {
  response: WorkerResponse;
  delivered_fields: WorkerDeliveredFields;
  transcript_hash: string;
  response_hash: string;
  delivered_fields_hash: string;
  model: string;
  prompt_version: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  abstain: boolean;
  abstain_reason: ReasonCode | null;
  steps: number;
}

// ---- Verifier contract ----
export type VerifierVerdict = "pass" | "fail" | "needs_human";

export interface VerifierInput {
  record: CanonicalRecord;
  worker: WorkerOutput;
  stepBudget: number;
  costBudget: number;
  stepsSoFar: number;
  costSoFar: number;
}

export interface VerifierOutput {
  verdict: VerifierVerdict;
  reason_code: ReasonCode | null; // AGENT_HALLUCINATION | AGENT_MALFORMED | AGENT_LOOP | BUDGET_EXCEEDED | UNVERIFIED_ANOMALY | null
  status: "ok" | "rejected" | "overruled" | "routed" | "killed";
  notes: string;
  checks: { name: string; pass: boolean; detail?: string }[];
}

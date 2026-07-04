/** Shared domain types for the CEDX fleet. */

export type SourceFormat = "feed" | "eml" | "pdf";
export type ReasonCode =
  | "STALE"
  | "MISSING_INPUT"
  | "OUTLIER"
  | "INJECTION_BLOCKED"
  | "LOW_CONFIDENCE"
  | "UNVERIFIED_ANOMALY"
  | "AGENT_HALLUCINATION"
  | "AGENT_LOOP"
  | "AGENT_MALFORMED"
  | "BUDGET_EXCEEDED"
  | "SCHEMA_DRIFT"
  | "SUPERSEDED_VERSION";
export type ReasonClass = "A" | "B";
export type RecordStatus = "delivered" | "exception" | "superseded";
export type ApprovalState =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "delivered"
  | "blocked";

/** Canonical normalized record after intake + field-mapping. */
export interface CanonicalRecord {
  id: string;
  owner: string | null;
  deadline: string | null;
  amount: number | null; // primary numeric field (appraised value)
  category: string | null;
  notes: string | null;
  version: number;
  source_format: SourceFormat;
  source_file: string;
  source_index: number;
  source_version_hash: string;
  payload: Record<string, unknown>;
  /** Field renames detected during mapping (SCHEMA_DRIFT evidence). */
  drifts: { canonical: string; source_key: string }[];
  raw: Record<string, unknown>;
}

export interface ApprovalEntry {
  state: ApprovalState;
  actor: string;
  ts: string;
  reason?: string | null;
}

export interface AgentSpan {
  agent: string;
  model: string | null;
  prompt_version: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  retries: number | null;
  transcript_hash: string | null;
  status:
    | "ok"
    | "retried"
    | "rejected"
    | "overruled"
    | "routed"
    | "abstained"
    | "killed";
  verdict?: string | null;
  note?: string | null;
}

export interface AuditRecord {
  id: string;
  version: number;
  source_format: SourceFormat;
  source_version_hash: string;
  status: RecordStatus;
  reason_code: ReasonCode | null;
  reason_class: ReasonClass | null;
  transcript_hash: string | null;
  delivered_fields: Record<string, unknown> | null;
  delivered_fields_hash: string | null;
  agent_trace: AgentSpan[];
  approval_trail: ApprovalEntry[];
  notes?: string | null;
}

export interface AgentRosterEntry {
  name: string;
  role:
    "orchestrator" | "worker" | "verifier" | "router" | "operator" | "other";
  models: string[];
  prompt_version: string;
  can_call: string[];
}

export interface AuditEvent {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  record_id: string | null;
}

export interface CostSummary {
  total_usd: number;
  avg_usd_per_record: number;
  p95_latency_ms: number;
  records: number;
  projected_usd_per_10k: number;
}

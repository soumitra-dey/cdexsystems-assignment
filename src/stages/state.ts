import type {
  CanonicalRecord,
  RecordStatus,
  ReasonCode,
  ReasonClass,
  AgentSpan,
  ApprovalEntry,
} from "../types.ts";
import type {
  OrchestratorOutput,
  WorkerOutput,
  VerifierOutput,
} from "../agents/contracts.ts";

/**
 * Mutable per-record processing state that flows through the stages.
 * Assembled into a final AuditRecord by the delivery stage.
 */
export interface ProcRecord {
  canonical: CanonicalRecord;
  route: OrchestratorOutput;
  worker?: WorkerOutput;
  verifier?: VerifierOutput;
  agent_trace: AgentSpan[];
  approval_trail: ApprovalEntry[];
  status: RecordStatus;
  reason_code: ReasonCode | null;
  reason_class: ReasonClass | null;
  delivered_fields: Record<string, unknown> | null;
  delivered_fields_hash: string | null;
  transcript_hash: string | null;
  notes: string;
}

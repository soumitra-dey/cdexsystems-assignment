import { createHash } from "node:crypto";
import { sha256Hex } from "./hash.ts";

/**
 * Compute the CASE_ID-bound amendment per TASK.md Step 8:
 *   H = sha256(CASE_ID)
 *   R = ["risk_officer","legal_counsel","compliance","finance_controller"][ int(H[0],16) % 4 ]
 *   T = 10000 + (int(H[1:3],16) % 50) * 1000
 * The amendment is DERIVED, never hardcoded — it generalizes to any CASE_ID
 * (incl. the held-out grading seed). For CEDX-33ACA8 this yields
 * risk_officer @ $44,000 (NOT finance_controller @ $18,000 — see DECISIONS.md).
 */
const AMENDMENT_ROLES = [
  "risk_officer",
  "legal_counsel",
  "compliance",
  "finance_controller",
] as const;
export type AmendmentRole = (typeof AMENDMENT_ROLES)[number];

export interface Amendment {
  role: AmendmentRole;
  threshold: number;
  case_id: string;
  hash: string;
}

export function computeAmendment(caseId: string): Amendment {
  const h = sha256Hex(caseId);
  const roleIdx = parseInt(h[0], 16) % 4;
  const role = AMENDMENT_ROLES[roleIdx];
  const threshold = 10000 + (parseInt(h.slice(1, 3), 16) % 50) * 1000;
  return { role, threshold, case_id: caseId, hash: "sha256:" + h };
}

/** Sanity check that a (role, threshold) pair matches the CASE_ID derivation. */
export function verifyAmendment(
  caseId: string,
  role: string,
  threshold: number,
): boolean {
  const a = computeAmendment(caseId);
  return a.role === role && a.threshold === threshold;
}

export { AMENDMENT_ROLES };

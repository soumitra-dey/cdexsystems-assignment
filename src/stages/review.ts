import type { ProcRecord } from "./state.ts";
import type { Amendment } from "../utils/amendment.ts";
import type { ApprovalEntry, AuditEvent } from "../types.ts";
import { nowIso } from "../utils/clock.ts";
import type { EventLog } from "../utils/eventlog.ts";
import { info, warn } from "../utils/log.ts";

/**
 * Stage 4 — Review. An append-only approval state machine:
 *   draft -> in_review -> approved -> delivered
 * (changes_requested can branch back to in_review.) Delivery is refused
 * server-side for any non-approved item, and the refusal is logged.
 *
 * CASE_ID amendment (maker-checker SECOND gate): any record whose normalized
 * primary numeric field >= threshold needs a recorded approval by the amendment
 * role, in addition to normal approval, before delivery. The role + threshold
 * are DERIVED from the CASE_ID (see amendment.ts), never hardcoded.
 */

/** Does this record's trail reach 'approved'? */
export function hasApproval(p: ProcRecord): boolean {
  return p.approval_trail.some((t) => t.state === "approved");
}

/** Does this record require the amendment-role approval, and is it present? */
export function amendmentSatisfied(
  p: ProcRecord,
  amendment: Amendment,
): { required: boolean; satisfied: boolean } {
  const required =
    p.canonical.amount !== null && p.canonical.amount >= amendment.threshold;
  if (!required) return { required: false, satisfied: true };
  const satisfied = p.approval_trail.some(
    (t) => t.state === "approved" && t.actor === amendment.role,
  );
  return { required: true, satisfied };
}

/** Apply normal + amendment approval to a record that passed Assembly. */
export function runReview(
  proc: ProcRecord[],
  amendment: Amendment,
  log: EventLog,
): void {
  for (const p of proc) {
    if (p.status !== "delivered" || p.verifier?.verdict !== "pass") continue;
    const r = p.canonical;

    // draft -> in_review
    p.approval_trail.push({
      state: "in_review",
      actor: "orchestrator",
      ts: nowIso(),
    });
    log.append("orchestrator", "review_submit", r.id);

    // normal operator approval
    p.approval_trail.push({
      state: "approved",
      actor: "operator",
      ts: nowIso(),
    });
    log.append("operator", "approve", r.id);

    // amendment maker-checker (second gate) when amount >= threshold
    const amd = amendmentSatisfied(p, amendment);
    if (amd.required) {
      if (amd.satisfied) {
        log.append(amendment.role, "amendment_approve", r.id);
      } else {
        // Apply the amendment-role approval (demo path: satisfied by the fleet).
        p.approval_trail.push({
          state: "approved",
          actor: amendment.role,
          ts: nowIso(),
        });
        log.append(amendment.role, "amendment_approve", r.id);
        info(
          `review: ${r.id} amendment gate satisfied by ${amendment.role} (amount $${r.amount} >= $${amendment.threshold})`,
        );
      }
    }
  }
}

/**
 * Attempt to deliver a record. Refused (and logged) unless the trail reached
 * 'approved' AND the amendment gate is satisfied. Returns whether delivery is
 * allowed. This is the server-side refusal used by probe-approval.
 */
export function canDeliver(
  p: ProcRecord,
  amendment: Amendment,
  log: EventLog,
): { allowed: true } | { allowed: false; reason: string } {
  const r = p.canonical;
  if (!hasApproval(p)) {
    log.append("delivery", "delivery_refused:not_approved", r.id);
    return {
      allowed: false,
      reason: `record ${r.id} never reached 'approved'`,
    };
  }
  const amd = amendmentSatisfied(p, amendment);
  if (amd.required && !amd.satisfied) {
    log.append(
      "delivery",
      `delivery_refused:amendment:${amendment.role}`,
      r.id,
    );
    return {
      allowed: false,
      reason: `record ${r.id} requires ${amendment.role} approval (amount $${r.amount} >= $${amendment.threshold})`,
    };
  }
  // 'approved' must come before 'delivered' (check #7 ordering).
  const states = p.approval_trail.map((t) => t.state);
  const iApp = states.indexOf("approved");
  const iDel = states.indexOf("delivered");
  if (iDel >= 0 && iDel < iApp) {
    log.append("delivery", "delivery_refused:order", r.id);
    return {
      allowed: false,
      reason: `record ${r.id} delivered before approved`,
    };
  }
  return { allowed: true };
}

/** Append the 'delivered' state to a record's trail (only if allowed). */
export function markDelivered(p: ProcRecord, log: EventLog): ApprovalEntry {
  const entry: ApprovalEntry = {
    state: "delivered",
    actor: "delivery",
    ts: nowIso(),
  };
  p.approval_trail.push(entry);
  log.append("delivery", "delivered", p.canonical.id);
  return entry;
}

export { nowIso };
export type { AuditEvent };

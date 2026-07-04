import type { AuditEvent } from "../types.ts";
import { nowIso } from "./clock.ts";

/**
 * Append-only event log. seq is strictly 0,1,2,... (check #9). Entries can only
 * be appended — never mutated or deleted (check: probe-append-only refuses
 * mutation). The log is the provenance backbone for `make replay`.
 */
export class EventLog {
  private events: AuditEvent[] = [];
  private seq = 0;

  append(
    actor: string,
    action: string,
    record_id: string | null = null,
  ): AuditEvent {
    const ev: AuditEvent = {
      seq: this.seq,
      ts: nowIso(),
      actor,
      action,
      record_id,
    };
    this.seq += 1;
    this.events.push(ev);
    return ev;
  }

  /** Attempt to mutate a past entry — REFUSED (append-only invariant). */
  mutate(seq: number): { refused: true; reason: string } {
    return {
      refused: true,
      reason: `audit log is append-only: refusal to mutate seq=${seq}`,
    };
  }

  /** Attempt to delete a past entry — REFUSED. */
  delete(seq: number): { refused: true; reason: string } {
    return {
      refused: true,
      reason: `audit log is append-only: refusal to delete seq=${seq}`,
    };
  }

  all(): AuditEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  count(): number {
    return this.events.length;
  }
}

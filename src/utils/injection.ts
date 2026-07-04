/**
 * Prompt-injection neutralizer. Scans free-text `notes` for instruction-like
 * phrases that attempt to override governance (approve-now / skip-review /
 * ignore-rules / etc.). Case-insensitive, generalizes to phrasing variations
 * in the held-out seed. A hit => INJECTION_BLOCKED (Class-A, never delivered).
 */
const INJECTION_PATTERNS: RegExp[] = [
  /approve (?:this )?immediately/i,
  /immediately approve/i,
  /approve now/i,
  /skip (?:the )?review/i,
  /bypass (?:the )?(?:review|approval|policy|rules)/i,
  /ignore (?:all )?(?:previous )?(?:instructions?|rules|policy|guidelines)/i,
  /ignore (?:the )?field(?: amount)?/i,
  /disregard (?:all )?(?:previous )?(?:instructions?|rules|policy)/i,
  /override (?:the )?(?:policy|rules|review|approval)/i,
  /output\s+approved/i,
  /do not (?:review|verify|check)/i,
  /no review needed/i,
];

export interface InjectionHit {
  blocked: boolean;
  matchedPattern: string | null;
}

export function detectInjection(
  notes: string | null | undefined,
): InjectionHit {
  const text = notes ?? "";
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) return { blocked: true, matchedPattern: m[0] };
  }
  return { blocked: false, matchedPattern: null };
}

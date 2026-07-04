/**
 * Deterministic monotonic clock so re-runs produce byte-identical audit bundles
 * (strong idempotency). Base epoch = PIPELINE_NOW at 00:00:00 UTC; each tick
 * advances by 1 ms. Real wall-clock would make every run differ.
 */
let _baseMs: number | null = null;
let _counter = 0;

export function resetClock(baseIso: string): void {
  const d = new Date(baseIso + "T00:00:00.000Z");
  _baseMs = d.getTime();
  _counter = 0;
}

export function nowIso(): string {
  if (_baseMs === null) resetClock("2026-06-26");
  const ts = _baseMs! + _counter;
  _counter += 1;
  return new Date(ts).toISOString();
}

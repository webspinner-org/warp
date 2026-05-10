import type { SpinnerName } from './manifest.js';
import type { AuditResult } from './audit-event.js';

/**
 * SilkPatternEntry — a single invocation record in a Spinner's history.
 *
 * The Silk Pattern is the per-Spinner memory. Every invocation appends
 * one entry. The placard surfaced in the Loom shows the most recent
 * entries plus aggregate metrics. Older entries roll into the Grimoire's
 * audit chain; the Silk Pattern is a denormalised view sized for the
 * Webspinner's eye, not the analyst's database.
 */
export interface SilkPatternEntry {
  readonly id: string;
  readonly spinner: SpinnerName;
  readonly capability: string;
  /** RFC 3339 timestamp. */
  readonly invokedAt: string;
  readonly durationMs: number;
  readonly result: AuditResult;
  /** One-line summary of input — never the full input bytes. */
  readonly inputSummary: string;
  /** One-line summary of output — what came back, not the full content. */
  readonly outputSummary: string;
  /** Audit event id this invocation produced, for cross-reference. */
  readonly auditEventId?: string;
  /** Optional error message when result is 'error' or 'denied'. */
  readonly errorMessage?: string;
}

/**
 * SilkPatternMetrics — aggregate metrics surfaced on the Spinner's
 * placard alongside the recent-entries list.
 *
 * Computed on read by the Loom; not stored. The window defaults to the
 * last 30 days but the Loom can request shorter or longer windows.
 */
export interface SilkPatternMetrics {
  /** Total invocations in the window. */
  readonly invocations: number;
  /** Successful invocations. */
  readonly successes: number;
  /** Errored invocations. */
  readonly errors: number;
  /** Denied invocations (gated, refused, integrity-fail). */
  readonly denials: number;
  /** Average duration of successful invocations, in milliseconds. */
  readonly avgDurationMs: number;
  /** Most recent invocation's RFC 3339 timestamp; null when no entries. */
  readonly lastInvokedAt: string | null;
  /** Window start, RFC 3339. */
  readonly windowStart: string;
  /** Window end (now), RFC 3339. */
  readonly windowEnd: string;
}

/** SilkPattern — the placard data structure the Loom renders. */
export interface SilkPattern {
  readonly spinner: SpinnerName;
  readonly metrics: SilkPatternMetrics;
  /** Recent entries, newest first. The Loom typically requests 10. */
  readonly recent: readonly SilkPatternEntry[];
}

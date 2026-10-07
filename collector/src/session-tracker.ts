import { randomUUID } from "node:crypto";
import type { DevMeterConfig } from "./config.ts";
import { sendSession } from "./api-client.ts";
import { estimateCostUsd } from "./pricing.ts";
import { extractTicketRef, getCurrentBranch, getProjectName, guessClientName } from "./git.ts";
import { writeStatusEntry, removeStatusEntry } from "./status-store.ts";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type TokenKind = "input" | "output" | "cacheRead" | "cacheCreation";

interface TokenBucket {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export type ModelBreakdown = Record<
  string,
  TokenBucket & { costUsd: number }
>;

/** Counter names — same keys as the ingest payload fields. */
export type SignalKey =
  | "promptCount"
  | "editAccepted"
  | "editRejected"
  | "toolCalls"
  | "toolErrors"
  | "linesAdded"
  | "linesRemoved"
  | "commitCount"
  | "prCount";

export type Signals = Partial<Record<SignalKey, number>>;

export class SessionTracker {
  private sessionId: string;
  private readonly cwd: string;
  private readonly config: DevMeterConfig;
  private readonly onIdleFlush?: (cwd: string) => void;
  private startedAt: Date;
  private tokensByModel = new Map<string, TokenBucket>();
  private signals: Signals = {};
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: DevMeterConfig,
    cwd: string,
    onIdleFlush?: (cwd: string) => void
  ) {
    this.sessionId = randomUUID();
    this.config = config;
    this.cwd = cwd;
    this.startedAt = new Date();
    this.onIdleFlush = onIdleFlush;
    this.scheduleSync();
  }

  addTokens(model: string, kind: TokenKind, value: number): void {
    const bucket =
      this.tokensByModel.get(model) ??
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    bucket[kind] += value;
    this.tokensByModel.set(model, bucket);
    this.writeStatus();
    this.scheduleIdleFlush();
  }

  /**
   * Adds to a friction/outcome counter. `value` may be 0 — that records "the
   * signal exists and is zero" (e.g. tool calls happened, none failed),
   * which is different from never having heard of it (field omitted).
   */
  addSignal(key: SignalKey, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.signals[key] = (this.signals[key] ?? 0) + value;
    this.scheduleIdleFlush();
  }

  private modelBreakdown(): ModelBreakdown {
    const breakdown: ModelBreakdown = {};
    for (const [model, bucket] of this.tokensByModel) {
      breakdown[model] = { ...bucket, costUsd: estimateCostUsd(model, bucket) };
    }
    return breakdown;
  }

  private totals() {
    let tokensInput = 0;
    let tokensOutput = 0;
    let tokensCacheRead = 0;
    let tokensCacheCreation = 0;
    let estimatedCostUsd = 0;
    const modelBreakdown = this.modelBreakdown();
    for (const bucket of Object.values(modelBreakdown)) {
      tokensInput += bucket.input;
      tokensOutput += bucket.output;
      tokensCacheRead += bucket.cacheRead;
      tokensCacheCreation += bucket.cacheCreation;
      estimatedCostUsd += bucket.costUsd;
    }
    return {
      tokensInput,
      tokensOutput,
      tokensCacheRead,
      tokensCacheCreation,
      estimatedCostUsd,
      modelBreakdown,
    };
  }

  private writeStatus(): void {
    const totals = this.totals();
    writeStatusEntry(this.cwd, {
      sessionId: this.sessionId,
      cwd: this.cwd,
      gitBranch: getCurrentBranch(this.cwd),
      startedAt: this.startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
      ...totals,
    });
  }

  /**
   * Periodic push of the in-progress session so the dashboard doesn't stay
   * empty for the whole session. Sent with `endedAt: now()` even though the
   * session is still running, so `sessionMinutes()` reads as "elapsed as of
   * the last sync" until the next sync (or idle-flush) catches it up — the
   * displayed duration can lag up to SYNC_INTERVAL_MS behind reality for a
   * session in progress.
   */
  private scheduleSync(): void {
    this.syncTimer = setInterval(() => {
      void this.sync();
    }, SYNC_INTERVAL_MS);
    this.syncTimer.unref?.();
  }

  private async sync(): Promise<void> {
    if (!this.hasActivity()) return;
    const gitBranch = getCurrentBranch(this.cwd);
    try {
      await sendSession(this.config, {
        clientSessionId: this.sessionId,
        projectName: getProjectName(this.cwd),
        clientName: guessClientName(this.cwd) ?? undefined,
        gitBranch: gitBranch ?? undefined,
        ticketRef: extractTicketRef(gitBranch) ?? undefined,
        startedAt: this.startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        ...this.totals(),
        ...this.signals,
      });
    } catch (error) {
      console.error("Failed to sync session to DevMeter:", error);
    }
  }

  private scheduleIdleFlush(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.finalize().then(() => this.onIdleFlush?.(this.cwd));
    }, IDLE_TIMEOUT_MS);
  }

  clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearSyncTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  hasActivity(): boolean {
    return this.tokensByModel.size > 0;
  }

  async finalize(): Promise<void> {
    this.clearIdleTimer();
    this.clearSyncTimer();
    if (!this.hasActivity()) return;

    await this.sync();

    this.tokensByModel.clear();
    this.signals = {};
    this.startedAt = new Date();
    // Tracker instances are reused across idle-flush cycles in `devmeter
    // start` (keyed by cwd, kept alive for the life of the collector). The
    // final `sync()` above still used the outgoing sessionId, so it's safe
    // to rotate it now — without this, the next work session would upsert
    // onto the same clientSessionId and silently overwrite the row we just
    // finalized instead of creating a new one.
    this.sessionId = randomUUID();
    removeStatusEntry(this.cwd);
    this.scheduleSync();
  }
}

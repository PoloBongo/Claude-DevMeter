import type { DevMeterConfig } from "./config.ts";
import type { ModelBreakdown } from "./session-tracker.ts";

export interface IngestPayload {
  clientSessionId: string;
  projectName: string;
  clientName?: string;
  gitBranch?: string;
  ticketRef?: string;
  startedAt: string;
  endedAt: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  estimatedCostUsd: number;
  modelBreakdown: ModelBreakdown;
  // Friction / outcome counters. Each is omitted until Claude Code actually
  // reported that signal, so "unknown" never gets sent as a misleading 0.
  promptCount?: number;
  editAccepted?: number;
  editRejected?: number;
  toolCalls?: number;
  toolErrors?: number;
  linesAdded?: number;
  linesRemoved?: number;
  commitCount?: number;
  prCount?: number;
}

export async function sendSession(
  config: DevMeterConfig,
  payload: IngestPayload
): Promise<void> {
  const res = await fetch(`${config.apiUrl}/api/sessions/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ingest failed (${res.status}): ${body}`);
  }
}

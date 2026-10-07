/**
 * Env vars that point Claude Code's OTLP export at a DevMeter receiver.
 * Shared by `devmeter claude` and `devmeter start` so both get the same
 * signals. Logs are enabled for the per-prompt / per-tool-call events that
 * aren't exposed as metrics. Deliberately NOT set: OTEL_LOG_USER_PROMPTS,
 * OTEL_LOG_TOOL_DETAILS — the receiver only ever counts events, it never
 * needs (or reads) prompt or tool content.
 */
export function otelEnv(endpoint: string): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_METRIC_EXPORT_INTERVAL: "10000",
    OTEL_LOGS_EXPORT_INTERVAL: "5000",
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
  };
}

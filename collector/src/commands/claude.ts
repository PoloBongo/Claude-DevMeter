import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { requireConfig } from "../config.ts";
import { SessionTracker } from "../session-tracker.ts";
import { startOtelReceiver } from "../otel-receiver.ts";
import { describeCodeVersion } from "../version.ts";
import { otelEnv } from "../otel-env.ts";

/**
 * Claude Code does not propagate OTEL_RESOURCE_ATTRIBUTES into its OTLP
 * export (verified empirically — the resource only ever carries host/service
 * metadata), so there's no way to tag a session's directory from the outside
 * and have a shared collector route it correctly. Instead, each invocation
 * gets its own dedicated OTLP receiver on an ephemeral port for the
 * lifetime of that one `claude` process: one server, one project, no
 * cross-session ambiguity possible by construction.
 */
export function claudeCommand(args: string[]): void {
  const config = requireConfig();
  const cwd = process.cwd();
  const tracker = new SessionTracker(config, cwd);

  const server = startOtelReceiver(() => tracker, cwd, 0);

  server.once("listening", () => {
    const { port } = server.address() as AddressInfo;
    console.error(`[devmeter] tracking this session — running from ${describeCodeVersion()}`);

    const env = {
      ...process.env,
      ...otelEnv(`http://localhost:${port}`),
    };

    const child = spawn("claude", args, {
      cwd,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    let flushed = false;
    const flushAndExit = async (code: number) => {
      if (flushed) return;
      flushed = true;
      tracker.clearIdleTimer();
      server.close();
      try {
        await tracker.finalize();
      } catch (error) {
        console.error("Failed to send session to DevMeter:", error);
      }
      process.exit(code);
    };

    child.on("error", (error) => {
      console.error(`Failed to launch \`claude\`: ${error.message}`);
      void flushAndExit(1);
    });

    child.on("exit", (code) => {
      void flushAndExit(code ?? 0);
    });
  });
}

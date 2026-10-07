import { requireConfig } from "../config.ts";
import { SessionTracker } from "../session-tracker.ts";
import { startOtelReceiver } from "../otel-receiver.ts";
import { describeCodeVersion } from "../version.ts";
import { otelEnv } from "../otel-env.ts";

export async function startCommand(): Promise<void> {
  const config = requireConfig();
  const fallbackCwd = process.cwd();
  const trackers = new Map<string, SessionTracker>();

  function getTracker(cwd: string): SessionTracker {
    let tracker = trackers.get(cwd);
    if (!tracker) {
      tracker = new SessionTracker(config, cwd, (flushedCwd) => {
        console.log(`\nIdle for 15 minutes — sent ${flushedCwd} to DevMeter.`);
      });
      trackers.set(cwd, tracker);
    }
    return tracker;
  }

  const server = startOtelReceiver(getTracker, fallbackCwd);

  const otelVars = otelEnv("http://localhost:4318");

  console.log("DevMeter collector listening on http://localhost:4318");
  console.log(
    `Running from ${describeCodeVersion()} — this process keeps this code ` +
      "for its whole lifetime; restart it after a `git pull` to the collector.\n"
  );
  console.log(
    "Recommended: from any project directory, run `devmeter claude` instead\n" +
      "of `claude` directly — it tags that session with its real directory,\n" +
      "so tokens land on the right project even if you switch directories\n" +
      "without restarting this collector.\n"
  );
  console.log(
    "Manual alternative (always attributed to where this collector was\n" +
      "started, regardless of where `claude` itself runs) — set these in a\n" +
      "separate terminal before running `claude` there:\n"
  );
  if (process.platform === "win32") {
    for (const [key, value] of Object.entries(otelVars)) {
      console.log(`  $env:${key} = "${value}"`);
    }
  } else {
    for (const [key, value] of Object.entries(otelVars)) {
      console.log(`  export ${key}=${value}`);
    }
  }
  console.log("");
  console.log("Press Ctrl+C to stop and send any in-progress sessions to DevMeter.\n");

  const shutdown = async () => {
    console.log("\nStopping collector, sending sessions…");
    for (const tracker of trackers.values()) tracker.clearIdleTimer();
    server.close();
    try {
      await Promise.all([...trackers.values()].map((tracker) => tracker.finalize()));
      console.log("Done.");
    } catch (error) {
      console.error("Failed to send sessions:", error);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

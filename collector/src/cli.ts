#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { loginCommand } from "./commands/login.ts";
import { startCommand } from "./commands/start.ts";
import { statusCommand } from "./commands/status.ts";
import { claudeCommand } from "./commands/claude.ts";
import { syncCommand } from "./commands/sync.ts";
import { statuslineCommand } from "./commands/statusline.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
) as { version: string };

const program = new Command();

program
  .name("devmeter")
  .description("DevMeter local collector — tracks time and AI cost per session")
  .version(version);

program
  .command("login")
  .argument("<api_key>", "personal API key from DevMeter → Settings")
  .option(
    "--api-url <url>",
    "DevMeter API base URL",
    process.env.DEVMETER_API_URL ?? "https://devmeter-pi.vercel.app"
  )
  .action((apiKey: string, options: { apiUrl: string }) => {
    loginCommand(apiKey, options.apiUrl);
  });

program
  .command("start")
  .description("Start listening for Claude Code telemetry in this directory")
  .action(() => {
    void startCommand();
  });

program
  .command("status")
  .description("Show all currently in-progress sessions, if any")
  .action(() => {
    statusCommand();
  });

program
  .command("sync")
  .description("Push the currently in-progress session(s) to DevMeter right now")
  .action(() => {
    void syncCommand();
  });

program
  .command("claude")
  .description(
    "Run `claude` tagged with the current directory, so a running " +
      "`devmeter start` attributes its tokens to the right project"
  )
  .allowUnknownOption()
  .argument("[args...]", "arguments passed through to `claude`")
  .action((args: string[]) => {
    claudeCommand(args);
  });

program
  .command("statusline")
  .description(
    "Print a one-line session coach for Claude Code's statusLine setting " +
      '(add {"statusLine":{"type":"command","command":"devmeter statusline"}} to ~/.claude/settings.json)'
  )
  .action(() => {
    void statuslineCommand();
  });

program.parse();

# DevMeter

[![devmeter-cli on npm](https://img.shields.io/npm/v/devmeter-cli?color=cb3837&logo=npm&label=devmeter-cli)](https://www.npmjs.com/package/devmeter-cli)
[![npm downloads](https://img.shields.io/npm/dm/devmeter-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/devmeter-cli)

Tracks time and Claude Code AI cost per ticket/project for freelancers and
small agencies, so you know what a mission really cost.

Two packages:

- **`web/`** — Next.js 16 app (dashboard, auth, API) deployed on Vercel.
- **`collector/`** — local CLI that listens to Claude Code's OpenTelemetry
  metrics and reports sessions to the web app.

## Prerequisites

- Node.js **22.6+** (24 recommended) — the collector runs TypeScript
  natively, no build step.
- A free [Neon](https://neon.tech) Postgres database.
- A free [Vercel](https://vercel.com) account.

## 1. Run the web app locally

```bash
cd web
npm install
cp .env.example .env
```

Edit `web/.env`:

- `DATABASE_URL` — from Neon: Dashboard → Connect → **pooled connection**
  string.
- `AUTH_SECRET` — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

Create the tables and start the dev server:

```bash
npx prisma migrate dev --name init
npm run dev
```

Open http://localhost:3000, create an account, and go to **Settings** to
generate your API key (shown once — copy it).

## 2. Deploy to Vercel

This is a monorepo, so the Vercel project's **Root Directory** must be set to
`web`:

```bash
vercel link            # first time: set Root Directory to "web" when asked,
                        # or set it later in Project Settings → General
vercel env add DATABASE_URL production
vercel env add AUTH_SECRET production
vercel --prod
```

Run `npx prisma migrate deploy` (with `DATABASE_URL` pointed at the same Neon
database) once after the first deploy to apply migrations there too.

## 3. Track a real project with the collector

Setting up a **new machine**? Paste [`SETUP_NEW_MACHINE.md`](SETUP_NEW_MACHINE.md)
into a fresh Claude Code session there and it'll do the rest.

One-time setup on a machine (never needs repeating after this) — the
collector is published on npm as [`devmeter-cli`](https://www.npmjs.com/package/devmeter-cli),
no repo clone needed:

```bash
npm install -g devmeter-cli
devmeter login <api_key>
```

`devmeter login` targets `https://devmeter-pi.vercel.app` by default; pass
`--api-url <url>` (or set `DEVMETER_API_URL`) to point at your own deployment
or a local dev server.

### Recommended: `devmeter claude`

Run this instead of `claude` directly, from inside the project you're
working on:

```bash
cd /path/to/your/project
devmeter claude
```

It launches `claude` (any arguments, e.g. `devmeter claude --resume <id>`,
pass through normally) with a dedicated local OTLP receiver for just that
session, tagged to the current directory by construction — no shared
state, no risk of tokens landing on the wrong project even if you switch
directories between sessions. When `claude` exits, the session is sent to
DevMeter automatically.

To stop typing `devmeter claude` every time, shadow `claude` in your shell
profile so plain `claude` does it for you:

**PowerShell** (`$PROFILE` — create it first with
`New-Item -ItemType File -Path $PROFILE -Force` if it doesn't exist):

```powershell
function claude {
    devmeter claude @args
}
```

**bash/zsh** (`~/.bashrc` / `~/.zshrc`):

```bash
claude() { devmeter claude "$@"; }
```

Open a new terminal afterward for the shell to pick it up.

### Alternative: `devmeter start`

A persistent collector you leave running in one terminal, with Claude Code
pointed at it manually in others. Simpler mentally, but every session run
while it's up is attributed to **wherever `devmeter start` itself was
launched from** — not wherever `claude` runs — since Claude Code's OTLP
export carries no directory info of its own.

```bash
cd /path/to/your/project
devmeter start
```

It prints the environment variables to export in another terminal before
running `claude` there. Run `devmeter status` to see all currently
in-progress sessions. Press **Ctrl+C** to stop and flush them to DevMeter.

### Either way

Sessions are tagged with the current git branch (and a ticket ref
auto-extracted from it, e.g. `fix/TICKET-148-...` → `TICKET-148`), and show
up on the dashboard as soon as the session ends.

### What the collector listens to

Both commands start a local OTLP/HTTP-JSON receiver and point Claude Code at
it (`OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER` = `otlp`):

| Endpoint | Signal | Used for |
|---|---|---|
| `/v1/metrics` | `claude_code.token.usage` | tokens per model, cost |
| `/v1/metrics` | `claude_code.lines_of_code.count` (`type` = added/removed) | `linesAdded`, `linesRemoved` |
| `/v1/metrics` | `claude_code.commit.count`, `claude_code.pull_request.count` | `commitCount`, `prCount` |
| `/v1/metrics` | `claude_code.code_edit_tool.decision` (`decision` = accept/reject) | `editAccepted`, `editRejected` |
| `/v1/logs` | `user_prompt` event | `promptCount` |
| `/v1/logs` | `tool_result` event (`success`) | `toolCalls`, `toolErrors` |

Collector 0.2.0 adds more event-based signals (all counters or short labels):

| Event | Used for |
|---|---|
| `api_request` (main conversation only) | `peakContextTokens` (largest input + cache read + cache creation of one request), `effort` (most-used level) |
| `compaction` | `compactionCount` |
| `api_error` | `apiErrorCount` |
| `permission_mode_changed` (`to_mode` = `plan`) | `planModeCount` |
| `subagent_completed`, `skill_activated` | `subagentRuns`, `skillActivations` |
| `feedback_survey` (`responded`, session survey) | `surveyResponse` — Claude Code's own "How is Claude doing?" rating |

Also recorded per session: `claudeCodeVersion` (from the OTLP resource) and
`claudeMdHash` / `claudeMdLines` — a 12-character fingerprint and line count of
the project's `CLAUDE.md`, never its text. The survey rating is routed to the
collector via `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL=1`; set
`DEVMETER_NO_SURVEY=1` to leave that untouched. Event counters such as
compactions are `0` (not unknown) once the event stream is flowing, and
omitted before that.

**Privacy:** only counters and metadata are stored. The receiver reads
`event.name` and `success` from log events and nothing else; prompt text and
tool inputs/outputs are never read or sent, and DevMeter does not enable
`OTEL_LOG_USER_PROMPTS` or `OTEL_LOG_TOOL_DETAILS`.

A counter is only sent once Claude Code has reported that signal, so a field
is `null` (shown as "—") rather than a misleading `0` when it is unknown.
Known limits: Claude Code does not expose reverts (that flag is manual), and
log events emitted in the last seconds before `claude` is killed may not be
flushed.

After upgrading the collector (`npm install -g devmeter-cli`), restart any
`devmeter start` / `devmeter claude` sessions that were already running — they
keep the code they started with.

### Statusline coach

`devmeter statusline` prints a one-line coach inside Claude Code, e.g.
`ctx 62% | cache 91% | 4 prompts, 1 commit (med 6) | $1.80 (med feature $2.40)`.
It flags (`!`) a context above 80%, a cold prompt cache, many prompts without a
commit, or a cost above twice the median for the branch's task type. Enable it
in `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "devmeter statusline" } }
```

It does no network I/O (a slow statusline script stalls the UI): live counters
come from the running `devmeter claude`/`start` process, and the per-task-type
medians (`GET /api/baselines`, last 90 days) are cached in
`~/.devmeter/baselines.json`, refreshed at most once a day at launch. A task
type needs at least 5 sessions before its median is shown.

### Diagnostics

Each session page has a **Diagnostics** panel, and Insights has a **What is
costing you** card (how many of the period's sessions with telemetry hit each
rule). They are computed on read from the counters above: nothing extra is
stored and no migration is involved. A rule is skipped when the data it needs
is missing, so older sessions never produce false findings. Each finding shows
its evidence and links to the matching Claude Code docs.

| Rule | Fires when |
|---|---|
| CLAUDE.md is long | more than 200 lines (the docs' guidance) |
| Very large context | peak context ≥ your own 90th percentile (floored at 80k; 150k until you have 10 sessions of history) — indicative |
| Repeated compactions | 2 or more |
| Low prompt-cache share | cache ratio under 50% on ≥ 50k input-side tokens (softened if compactions explain it) |
| Many prompts, no commit | prompts ≥ 2× the task-type median (min. 8), or 15 without a baseline |
| Cost well above normal | ≥ 2× the task-type median cost |
| Many rejected edits | ≥ 30% of at least 5 edit decisions rejected |
| Lots of failing tool calls | ≥ 20% of at least 10 tool calls failed |
| High effort on a short session | effort `xhigh`/`max` with ≤ 3 prompts |
| Opus on a small task | ≥ 80% of cost on Opus, ≤ 3 prompts, < 50 lines changed |
| API errors | 3 or more failed requests |

Task-type medians need at least 5 sessions of that type (last 90 days). Not
covered, because Claude Code does not report it: "several unrelated tasks
without /clear" and "MCP server connected but never used".

### Export

**Export CSV / Export JSON** on the Insights page download every session
(one flat row each, including all the signals above, your rating, tag and
comment) with the page's project/period filters. Text cells are neutralized
against spreadsheet formula injection. API: `GET /api/export?format=csv|json&project=&period=`.

### Insights

The **Insights** page compares sessions by task type (average cost, prompts
and cache ratio), lists the week's most expensive and chattiest sessions, and
plots prompts per successful session (one that ended in at least one commit)
over time. Each session has a detail page where you can set its task type,
a 1–5 rating, a short comment and a "reverted later" flag.

## Data model

- `User` — email/password, hourly rate, hashed API key.
- `Project` — one per client/repo, auto-created by the collector on first
  ingest (matched by name) or manually from the dashboard.
- `Session` — one row per collector run: git branch, ticket ref, start/end
  time, token counts, estimated AI cost, plus the quality signals below.
  Every signal column is nullable: `null` means "not reported" (older
  sessions, older collectors, imports), never zero.
  - `taskType` — `bugfix | feature | refactor | chore | docs | test | other`,
    derived from the branch prefix (`fix/`, `bugfix/`, `feat/`, `feature/`,
    `refactor/`, …, `other` by default). `taskTypeManual` is set when edited
    in the dashboard, so later syncs don't overwrite it.
  - Friction counters: `promptCount`, `editAccepted`, `editRejected`,
    `toolCalls`, `toolErrors`, `linesAdded`, `linesRemoved`.
  - Outcome: `commitCount`, `prCount` (a session "ended in a commit" when
    `commitCount > 0`), and manual `rating` (1–5), `ratingComment`,
    `revertedLater`.
  - Telemetry v2: `compactionCount`, `peakContextTokens`, `apiErrorCount`,
    `planModeCount`, `subagentRuns`, `skillActivations`, `effort`,
    `claudeCodeVersion`, `claudeMdHash`, `claudeMdLines`, `surveyResponse`;
    and a manual free-form `tag`.
  - Cache ratio is computed on read, not stored:
    `cacheRead / (input + cacheRead + cacheCreation)`.

## Updating AI pricing

`collector/pricing.json` holds $/million-token rates per model tier
(sonnet/opus/haiku). Anthropic pricing changes over time — check
https://www.anthropic.com/pricing and update this file; no code changes
needed.

import Link from "next/link";
import { auth } from "@/lib/auth";
import { getInsightsData, type DashboardPeriod, type InsightSession } from "@/lib/queries";
import { formatDateLocal } from "@/lib/format";
import { formatMoney, type Currency } from "@/lib/currency";
import { TASK_TYPE_LABELS } from "@/lib/task-type";
import { DashboardFilters } from "@/components/dashboard-filters";
import { PromptTrendChart } from "@/components/prompt-trend-chart";

const TYPE_GRID = "grid grid-cols-[1.3fr_0.8fr_1fr_1fr_1fr]";
const TOP_GRID = "grid grid-cols-[1fr_2fr_0.8fr_0.8fr]";

function TopList({
  title,
  rows,
  currency,
  empty,
}: {
  title: string;
  rows: InsightSession[];
  currency: Currency;
  empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5.5 py-3 text-[13.5px] font-medium text-foreground-secondary">
        {title}
      </div>
      <div
        className={`${TOP_GRID} px-5.5 py-2.5 text-[11.5px] uppercase tracking-wide text-muted border-b border-border`}
      >
        <span>Date</span>
        <span>Session</span>
        <span>Prompts</span>
        <span>Cost</span>
      </div>
      {rows.length === 0 && (
        <div className="px-5.5 py-8 text-center text-sm text-muted">{empty}</div>
      )}
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/dashboard/sessions/${row.id}`}
          className={`${TOP_GRID} items-center px-5.5 py-3 border-b border-border/60 last:border-b-0 hover:bg-overlay-hover`}
        >
          <span className="font-mono text-[12.5px] text-muted">
            {new Date(row.startedAt).toLocaleDateString()}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px]">
              {row.ticketRef ?? row.gitBranch ?? "—"}
            </span>
            <span className="text-[11.5px] text-dim">
              {row.projectName} · {TASK_TYPE_LABELS[row.taskType]}
            </span>
          </div>
          <span className="font-mono text-[13px]">{row.promptCount ?? "—"}</span>
          <span className="font-mono text-[13px] text-accent">
            {formatMoney(row.cost, currency)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string;
    period?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await auth();
  const { project, period, from, to } = await searchParams;

  const normalizedPeriod: DashboardPeriod =
    period === "7" || period === "30" || period === "all" || period === "custom"
      ? period
      : "month";

  const parseDateParam = (value: string | undefined): Date | null => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const customFrom = parseDateParam(from) ?? defaultFrom;
  const customTo = parseDateParam(to) ?? new Date();

  const data = await getInsightsData(session!.user.id, {
    projectId: project,
    period: normalizedPeriod,
    customFrom,
    customTo,
  });

  const missingSignals = data.sessionCount - data.sessionsWithSignals;

  return (
    <div className="mx-auto w-full max-w-5xl px-7 py-8">
      <div className="mb-6.5">
        <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-1 text-[13px] text-muted">
          How different kinds of work compare — not just what they cost.
        </p>
      </div>

      <div className="mb-5">
        <DashboardFilters
          projects={data.projectOptions}
          clients={[]}
          sources={[]}
          defaultFrom={formatDateLocal(customFrom)}
          defaultTo={formatDateLocal(customTo)}
        />
      </div>

      {missingSignals > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-surface px-5 py-3.5 text-[12.5px] text-muted">
          {missingSignals} of {data.sessionCount} sessions in this period have no
          friction data (recorded before the collector reported it) — they count
          toward cost, but are left out of the prompt averages.
        </div>
      )}

      <div className="mb-5 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5.5 py-3 text-[13.5px] font-medium text-foreground-secondary">
          By task type
        </div>
        <div
          className={`${TYPE_GRID} px-5.5 py-2.5 text-[11.5px] uppercase tracking-wide text-muted border-b border-border`}
        >
          <span>Type</span>
          <span>Sessions</span>
          <span>Avg cost</span>
          <span>Avg prompts</span>
          <span>Cache ratio</span>
        </div>
        {data.byType.length === 0 && (
          <div className="px-5.5 py-8 text-center text-sm text-muted">
            No sessions in this period.
          </div>
        )}
        {data.byType.map((stat) => (
          <div
            key={stat.taskType}
            className={`${TYPE_GRID} items-center px-5.5 py-3 border-b border-border/60 last:border-b-0`}
          >
            <span className="text-[13px] font-medium">{TASK_TYPE_LABELS[stat.taskType]}</span>
            <span className="font-mono text-[13px]">{stat.sessions}</span>
            <span className="font-mono text-[13px] text-accent">
              {formatMoney(stat.avgCost, data.currency)}
            </span>
            <span className="font-mono text-[13px]">
              {stat.avgPrompts === null ? "—" : stat.avgPrompts.toFixed(1)}
              {stat.avgPrompts !== null && stat.promptSamples < stat.sessions && (
                <span className="ml-1.5 text-[10.5px] text-dim">
                  (n={stat.promptSamples})
                </span>
              )}
            </span>
            <span className="font-mono text-[13px]">
              {stat.avgCacheRatio === null ? "—" : `${(stat.avgCacheRatio * 100).toFixed(0)}%`}
            </span>
          </div>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <TopList
          title="Most expensive — last 7 days"
          rows={data.mostExpensive}
          currency={data.currency}
          empty="No sessions in the last 7 days."
        />
        <TopList
          title="Chattiest — last 7 days"
          rows={data.chattiest}
          currency={data.currency}
          empty="No prompt data in the last 7 days."
        />
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 text-[13.5px] font-medium text-foreground-secondary">
          Prompts per successful session
        </div>
        <div className="mb-3 text-[12px] text-dim">
          Sessions that ended in at least one commit. Going down over time means
          you are getting there in fewer turns.
        </div>
        {data.successfulTrend.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted">
            No committed sessions with prompt data in this period yet.
          </div>
        ) : (
          <PromptTrendChart data={data.successfulTrend} />
        )}
      </div>
    </div>
  );
}

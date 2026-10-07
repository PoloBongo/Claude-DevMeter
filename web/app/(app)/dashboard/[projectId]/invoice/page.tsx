import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  getProjectDetail,
  groupSessionsByDay,
  sessionMinutes,
  type SessionRowData,
} from "@/lib/queries";
import { formatDuration } from "@/lib/format";
import { formatMoney } from "@/lib/currency";
import { effectiveTaskType } from "@/lib/task-type";
import { PrintButton } from "@/components/print-button";

const RANGE_LABEL: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  all: "All time",
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string; q?: string }>;
}) {
  const session = await auth();
  const { projectId } = await params;
  const { range, q } = await searchParams;

  const normalizedRange = range === "7" || range === "all" ? range : "30";
  const detail = await getProjectDetail(session!.user.id, projectId, {
    range: normalizedRange,
    q,
  });
  if (!detail) notFound();

  const filtered = detail.project.sessions;

  const rows: SessionRowData[] = filtered.map((s) => ({
    id: s.id,
    startedAt: s.startedAt.toISOString(),
    ticketRef: s.ticketRef,
    gitBranch: s.gitBranch,
    durationMinutes: sessionMinutes(s),
    tokensInput: s.tokensInput,
    tokensOutput: s.tokensOutput,
    tokensCacheRead: s.tokensCacheRead,
    tokensCacheCreation: s.tokensCacheCreation,
    cost: detail.sessionCost(s),
    paygCost: detail.sessionCostPaygEquivalent(s),
    taskType: effectiveTaskType(s),
    modelCosts: null,
  }));

  const dayGroups = groupSessionsByDay(rows);
  const totalMinutes = rows.reduce((sum, r) => sum + r.durationMinutes, 0);
  const totalAiCost = rows.reduce((sum, r) => sum + r.cost, 0);
  const timeCost = (totalMinutes / 60) * detail.hourlyRate;
  const grandTotal = timeCost + totalAiCost;

  const periodStart =
    filtered.length > 0
      ? filtered[filtered.length - 1].startedAt
      : null;
  const periodEnd = filtered.length > 0 ? filtered[0].startedAt : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-7 py-8">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/${projectId}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
        >
          ← Back to project
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-xl border border-border bg-surface p-8 print:border-0 print:bg-white print:p-0 print:text-black">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
            <p className="mt-1 text-[13px] text-muted print:text-neutral-600">
              Generated {new Date().toLocaleDateString()}
            </p>
          </div>
          <div className="text-right text-[13px]">
            <div className="text-muted print:text-neutral-600">From</div>
            <div>{session!.user.email}</div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-6 text-[13px]">
          <div>
            <div className="mb-1 text-muted print:text-neutral-600">Bill to</div>
            <div className="font-medium">
              {detail.project.clientName ?? detail.project.name}
            </div>
            {detail.project.clientName && (
              <div className="text-dim print:text-neutral-500">
                Project: {detail.project.name}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-muted print:text-neutral-600">Period</div>
            <div>{RANGE_LABEL[normalizedRange]}</div>
            {periodStart && periodEnd && (
              <div className="text-dim print:text-neutral-500">
                {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border print:rounded-none print:border-neutral-300">
          <div className="grid grid-cols-[1.2fr_2fr_1fr_1fr] bg-surface-2 px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted print:bg-neutral-100 print:text-neutral-600">
            <span>Date</span>
            <span>Ticket / branch</span>
            <span>Duration</span>
            <span>AI cost</span>
          </div>

          {dayGroups.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-muted">
              No sessions in this period.
            </div>
          )}

          {dayGroups.map((group) => {
            const dayDuration = group.sessions.reduce((sum, r) => sum + r.durationMinutes, 0);
            const dayCost = group.sessions.reduce((sum, r) => sum + r.cost, 0);
            const label =
              group.sessions.length === 1
                ? (group.sessions[0].ticketRef ?? group.sessions[0].gitBranch ?? "—")
                : `${group.sessions.length} sessions`;

            return (
              <div
                key={group.dateKey}
                className="grid grid-cols-[1.2fr_2fr_1fr_1fr] border-t border-border px-4 py-2.5 text-[13px] print:border-neutral-200"
              >
                <span className="font-mono">
                  {new Date(group.sessions[0].startedAt).toLocaleDateString()}
                </span>
                <span>{label}</span>
                <span className="font-mono">{formatDuration(dayDuration)}</span>
                <span className="font-mono">{formatMoney(dayCost, detail.currency)}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-64 text-[13px]">
            <div className="flex justify-between py-1.5">
              <span className="text-muted print:text-neutral-600">
                Time ({formatDuration(totalMinutes)} × {formatMoney(detail.hourlyRate, detail.currency)}/h)
              </span>
              <span className="font-mono">{formatMoney(timeCost, detail.currency)}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted print:text-neutral-600">AI cost</span>
              <span className="font-mono">{formatMoney(totalAiCost, detail.currency)}</span>
            </div>
            <div className="flex justify-between border-t border-border py-2 text-[14.5px] font-semibold print:border-neutral-300">
              <span>Total</span>
              <span className="font-mono">{formatMoney(grandTotal, detail.currency)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

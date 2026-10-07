import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSessionDetail } from "@/lib/queries";
import { formatDuration, formatTokens } from "@/lib/format";
import { formatMoney } from "@/lib/currency";
import { deriveTaskType, TASK_TYPE_LABELS } from "@/lib/task-type";
import { SessionReviewForm } from "@/components/session-review-form";
import { ToastFromQuery } from "@/components/toast-from-query";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4.5 py-4">
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      <div className="font-mono text-[19px] font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-dim">{hint}</div>}
    </div>
  );
}

/** null = the collector never reported this signal (older session), shown as an em dash rather than 0. */
const count = (value: number | null) => (value === null ? "—" : formatTokens(value));

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const authSession = await auth();
  const { sessionId } = await params;
  const detail = await getSessionDetail(authSession!.user.id, sessionId);
  if (!detail) notFound();

  const { session, currency } = detail;
  const toolCallsHint =
    session.toolCalls !== null && session.toolErrors !== null
      ? `${session.toolErrors} failed of ${session.toolCalls}`
      : undefined;
  const editsTotal =
    session.editAccepted !== null || session.editRejected !== null
      ? (session.editAccepted ?? 0) + (session.editRejected ?? 0)
      : null;
  const committed =
    session.commitCount === null ? "—" : session.commitCount > 0 ? "Yes" : "No";

  return (
    <div className="mx-auto w-full max-w-5xl px-7 py-8">
      <ToastFromQuery />
      <Link
        href={`/dashboard/${session.project.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
      >
        ← {session.project.name}
      </Link>

      <div className="mb-5.5">
        <h1 className="text-xl font-semibold tracking-tight">
          {session.ticketRef ?? session.gitBranch ?? "Session"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span>{session.startedAt.toLocaleString()}</span>
          {session.gitBranch && (
            <span className="font-mono text-[12px] text-dim">{session.gitBranch}</span>
          )}
          <span className="rounded-md border border-border px-1.5 py-0.5 text-[11.5px]">
            {TASK_TYPE_LABELS[detail.taskType]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="mb-2.5 text-[13.5px] font-medium text-foreground-secondary">Cost & efficiency</h2>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <Stat label="Duration" value={formatDuration(detail.durationMinutes)} />
              <Stat
                label="AI cost"
                value={formatMoney(detail.cost, currency)}
                hint={
                  detail.pricingMode !== "PAYG" &&
                  Math.round(detail.paygCost * 100) !== Math.round(detail.cost * 100)
                    ? `≈ ${formatMoney(detail.paygCost, currency)} payg`
                    : undefined
                }
              />
              <Stat
                label="Cache ratio"
                value={detail.cacheRatio === null ? "—" : `${(detail.cacheRatio * 100).toFixed(0)}%`}
                hint="cache read / all input"
              />
              <Stat
                label="Tokens"
                value={formatTokens(
                  session.tokensInput +
                    session.tokensOutput +
                    session.tokensCacheRead +
                    session.tokensCacheCreation
                )}
                hint={`${formatTokens(session.tokensInput)} in · ${formatTokens(session.tokensOutput)} out`}
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2.5 text-[13.5px] font-medium text-foreground-secondary">Friction</h2>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <Stat label="Prompts" value={count(session.promptCount)} />
              <Stat
                label="Edits accepted"
                value={count(session.editAccepted)}
                hint={
                  editsTotal !== null
                    ? `${session.editRejected ?? 0} rejected of ${editsTotal}`
                    : undefined
                }
              />
              <Stat
                label="Tool calls"
                value={count(session.toolCalls)}
                hint={toolCallsHint}
              />
              <Stat
                label="Lines"
                value={
                  session.linesAdded === null && session.linesRemoved === null
                    ? "—"
                    : `+${formatTokens(session.linesAdded ?? 0)} / −${formatTokens(session.linesRemoved ?? 0)}`
                }
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2.5 text-[13.5px] font-medium text-foreground-secondary">Outcome</h2>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <Stat label="Ended in a commit" value={committed} />
              <Stat label="Commits" value={count(session.commitCount)} />
              <Stat label="Pull requests" value={count(session.prCount)} />
              <Stat
                label="Rating"
                value={session.rating === null ? "—" : `${session.rating} / 5`}
                hint={session.revertedLater ? "Reverted later" : undefined}
              />
            </div>
          </div>
        </div>

        <div className="h-fit rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3.5 text-[13.5px] font-medium text-foreground-secondary">Review</h2>
          <SessionReviewForm
            sessionId={session.id}
            taskType={detail.taskType}
            taskTypeManual={session.taskTypeManual}
            derivedLabel={TASK_TYPE_LABELS[deriveTaskType(session.gitBranch)]}
            rating={session.rating}
            ratingComment={session.ratingComment}
            revertedLater={session.revertedLater}
          />
        </div>
      </div>
    </div>
  );
}

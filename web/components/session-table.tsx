"use client";

import { useState } from "react";
import Link from "next/link";
import { TASK_TYPE_LABELS } from "@/lib/task-type";
import { formatDuration, formatTokens } from "@/lib/format";
import { formatMoney, type Currency } from "@/lib/currency";
import { DeleteSessionButton } from "@/components/delete-session-button";
import type { SessionDayGroup, SessionRowData } from "@/lib/queries";

const GRID = "grid grid-cols-[1fr_1.8fr_0.9fr_1.1fr_0.9fr_auto] items-center";

function sumTokens(row: SessionRowData): number {
  return row.tokensInput + row.tokensOutput + row.tokensCacheRead + row.tokensCacheCreation;
}

function CostCell({
  cost,
  paygCost,
  currency,
  showPaygHint,
  modelCosts,
}: {
  cost: number;
  paygCost: number;
  currency: Currency;
  showPaygHint: boolean;
  modelCosts?: { model: string; cost: number }[] | null;
}) {
  return (
    <div className="font-mono text-[13px] text-accent">
      {formatMoney(cost, currency)}
      {showPaygHint && Math.round(paygCost * 100) !== Math.round(cost * 100) && (
        <div className="text-[10.5px] text-dim">
          ≈ {formatMoney(paygCost, currency)} payg
        </div>
      )}
      {modelCosts && modelCosts.length > 1 && (
        <div className="text-[10.5px] text-dim">
          {modelCosts
            .map(({ model, cost: modelCost }) => `${model}: ${formatMoney(modelCost, currency)}`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function TokensCell({ row }: { row: SessionRowData }) {
  return (
    <div className="font-mono text-[13px] text-muted">
      {formatTokens(sumTokens(row))}
      {(row.tokensCacheRead > 0 || row.tokensCacheCreation > 0) && (
        <div className="text-[10.5px] text-dim">
          {formatTokens(row.tokensInput)} in · {formatTokens(row.tokensOutput)} out ·{" "}
          {formatTokens(row.tokensCacheRead)} cache read ·{" "}
          {formatTokens(row.tokensCacheCreation)} cache write
        </div>
      )}
    </div>
  );
}

function SingleSessionRow({
  row,
  projectId,
  currency,
  showPaygHint,
  nested,
}: {
  row: SessionRowData;
  projectId: string;
  currency: Currency;
  showPaygHint: boolean;
  nested?: boolean;
}) {
  return (
    <div
      className={`${GRID} px-5.5 py-3.5 border-b border-border/60 last:border-b-0 ${nested ? "bg-nested-bg" : ""}`}
    >
      <span className="font-mono text-[12.5px] text-muted">
        {nested
          ? new Date(row.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : new Date(row.startedAt).toLocaleDateString()}
      </span>
      <div className="flex flex-col gap-0.5">
        <Link
          href={`/dashboard/sessions/${row.id}`}
          className="text-[13px] hover:text-accent hover:underline"
        >
          {row.ticketRef ?? "Details"}
        </Link>
        <span className="font-mono text-[11.5px] text-dim">
          {row.gitBranch ?? "—"} · {TASK_TYPE_LABELS[row.taskType]}
        </span>
      </div>
      <span className="font-mono text-[13px]">{formatDuration(row.durationMinutes)}</span>
      <TokensCell row={row} />
      <CostCell
        cost={row.cost}
        paygCost={row.paygCost}
        currency={currency}
        showPaygHint={showPaygHint}
        modelCosts={row.modelCosts}
      />
      <DeleteSessionButton sessionId={row.id} projectId={projectId} />
    </div>
  );
}

function DayGroupRow({
  group,
  projectId,
  currency,
  showPaygHint,
}: {
  group: SessionDayGroup;
  projectId: string;
  currency: Currency;
  showPaygHint: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (group.sessions.length === 1) {
    return (
      <SingleSessionRow
        row={group.sessions[0]}
        projectId={projectId}
        currency={currency}
        showPaygHint={showPaygHint}
      />
    );
  }

  const totalDuration = group.sessions.reduce((sum, r) => sum + r.durationMinutes, 0);
  const totalTokens = group.sessions.reduce((sum, r) => sum + sumTokens(r), 0);
  const totalCost = group.sessions.reduce((sum, r) => sum + r.cost, 0);
  const totalPaygCost = group.sessions.reduce((sum, r) => sum + r.paygCost, 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`${GRID} w-full px-5.5 py-3.5 border-b border-border/60 last:border-b-0 text-left cursor-pointer hover:bg-overlay-hover`}
      >
        <span className="font-mono text-[12.5px] text-muted flex items-center gap-1.5">
          <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>
            ›
          </span>
          {new Date(group.sessions[0].startedAt).toLocaleDateString()}
        </span>
        <span className="text-[13px] text-dim">{group.sessions.length} sessions</span>
        <span className="font-mono text-[13px]">{formatDuration(totalDuration)}</span>
        <span className="font-mono text-[13px] text-muted">{formatTokens(totalTokens)}</span>
        <CostCell
          cost={totalCost}
          paygCost={totalPaygCost}
          currency={currency}
          showPaygHint={showPaygHint}
        />
        <span />
      </button>
      {expanded &&
        group.sessions.map((row) => (
          <SingleSessionRow
            key={row.id}
            row={row}
            projectId={projectId}
            currency={currency}
            showPaygHint={showPaygHint}
            nested
          />
        ))}
    </div>
  );
}

export function SessionTable({
  dayGroups,
  projectId,
  currency,
  showPaygHint,
}: {
  dayGroups: SessionDayGroup[];
  projectId: string;
  currency: Currency;
  showPaygHint: boolean;
}) {
  return (
    <>
      {dayGroups.map((group) => (
        <DayGroupRow
          key={group.dateKey}
          group={group}
          projectId={projectId}
          currency={currency}
          showPaygHint={showPaygHint}
        />
      ))}
    </>
  );
}

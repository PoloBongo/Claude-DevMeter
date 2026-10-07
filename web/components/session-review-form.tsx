"use client";

import { reviewSessionAction } from "@/app/(app)/dashboard/actions";
import { useToast } from "@/components/toast-provider";
import { SubmitButton } from "@/components/submit-button";
import { TASK_TYPES, TASK_TYPE_LABELS } from "@/lib/task-type";

const FIELD =
  "rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-[13px] text-foreground outline-none focus:border-accent/50";

export function SessionReviewForm({
  sessionId,
  taskType,
  taskTypeManual,
  derivedLabel,
  rating,
  ratingComment,
  revertedLater,
  tag,
}: {
  sessionId: string;
  taskType: string;
  taskTypeManual: boolean;
  /** Label of the type the branch implies, shown on the "Auto" option. */
  derivedLabel: string;
  rating: number | null;
  ratingComment: string | null;
  revertedLater: boolean | null;
  tag: string | null;
}) {
  const toast = useToast();

  return (
    <form
      action={async (formData) => {
        await reviewSessionAction(formData);
        toast("Session updated");
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="sessionId" value={sessionId} />

      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Task type
        <select
          name="taskType"
          defaultValue={taskTypeManual ? taskType : "auto"}
          className={`${FIELD} cursor-pointer`}
        >
          <option value="auto">Auto — from branch ({derivedLabel})</option>
          {TASK_TYPES.map((type) => (
            <option key={type} value={type}>
              {TASK_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Rating
        <select
          name="rating"
          defaultValue={rating?.toString() ?? ""}
          className={`${FIELD} cursor-pointer`}
        >
          <option value="">Not rated</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} / 5
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Comment
        <textarea
          name="ratingComment"
          defaultValue={ratingComment ?? ""}
          maxLength={280}
          rows={3}
          placeholder="Short note (280 characters max)"
          className={FIELD}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Tag
        <input
          name="tag"
          defaultValue={tag ?? ""}
          maxLength={40}
          placeholder="e.g. prompt style, experiment arm"
          className={FIELD}
        />
      </label>

      <label className="flex items-center gap-2 text-[13px] text-foreground-secondary">
        <input
          type="checkbox"
          name="revertedLater"
          defaultChecked={revertedLater === true}
          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
        />
        Reverted later
      </label>

      <SubmitButton
        pendingLabel="Saving…"
        className="w-fit cursor-pointer rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-background"
      >
        Save
      </SubmitButton>
    </form>
  );
}

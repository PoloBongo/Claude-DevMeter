"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveTaskType, isTaskType } from "@/lib/task-type";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  clientName: z.string().trim().max(120).optional(),
});

export async function createProjectAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    clientName: formData.get("clientName") || undefined,
  });

  if (!parsed.success) {
    return;
  }

  await prisma.project.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      clientName: parsed.data.clientName ?? null,
    },
  });

  revalidatePath("/dashboard");
}

const updateClientSchema = z.object({
  projectId: z.string().min(1),
  clientName: z.string().trim().max(120).optional(),
});

export async function updateProjectClientAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const parsed = updateClientSchema.safeParse({
    projectId: formData.get("projectId"),
    clientName: formData.get("clientName") || undefined,
  });
  if (!parsed.success) return;

  await prisma.project.updateMany({
    where: { id: parsed.data.projectId, userId: session.user.id },
    data: { clientName: parsed.data.clientName ?? null },
  });

  revalidatePath(`/dashboard/${parsed.data.projectId}`);
  revalidatePath("/dashboard");
}

const deleteProjectSchema = z.object({
  projectId: z.string().min(1),
});

export async function deleteProjectAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const parsed = deleteProjectSchema.safeParse({
    projectId: formData.get("projectId"),
  });
  if (!parsed.success) return;

  await prisma.project.deleteMany({
    where: { id: parsed.data.projectId, userId: session.user.id },
  });

  revalidatePath("/dashboard");
  redirect("/dashboard?toast=Project+deleted");
}

const deleteSessionSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
});

export async function deleteSessionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const parsed = deleteSessionSchema.safeParse({
    sessionId: formData.get("sessionId"),
    projectId: formData.get("projectId"),
  });
  if (!parsed.success) return;

  await prisma.session.deleteMany({
    where: {
      id: parsed.data.sessionId,
      project: { id: parsed.data.projectId, userId: session.user.id },
    },
  });

  revalidatePath(`/dashboard/${parsed.data.projectId}`);
  revalidatePath("/dashboard");
}

const reviewSessionSchema = z.object({
  sessionId: z.string().min(1),
  taskType: z.string().max(20),
  rating: z.string().max(2),
  ratingComment: z.string().trim().max(280),
  revertedLater: z.string().max(10),
  tag: z.string().trim().max(40),
});

/**
 * Manual review of one session: task type, 1-5 rating, short comment and the
 * "reverted later" flag. `taskType` of "auto" re-derives from the branch and
 * hands control back to ingest; any explicit type pins it (taskTypeManual).
 */
export async function reviewSessionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const parsed = reviewSessionSchema.safeParse({
    sessionId: formData.get("sessionId"),
    taskType: formData.get("taskType") ?? "auto",
    rating: formData.get("rating") ?? "",
    ratingComment: formData.get("ratingComment") ?? "",
    revertedLater: formData.get("revertedLater") ?? "",
    tag: formData.get("tag") ?? "",
  });
  if (!parsed.success) return;
  const input = parsed.data;

  const existing = await prisma.session.findFirst({
    where: { id: input.sessionId, project: { userId: session.user.id } },
    select: { id: true, gitBranch: true, projectId: true },
  });
  if (!existing) return;

  const ratingNumber = Number(input.rating);
  const rating =
    Number.isInteger(ratingNumber) && ratingNumber >= 1 && ratingNumber <= 5
      ? ratingNumber
      : null;

  const manualType = isTaskType(input.taskType) ? input.taskType : null;

  await prisma.session.update({
    where: { id: existing.id },
    data: {
      taskType: manualType ?? deriveTaskType(existing.gitBranch),
      taskTypeManual: manualType !== null,
      rating,
      ratingComment: input.ratingComment || null,
      revertedLater: input.revertedLater === "on" ? true : null,
      tag: input.tag || null,
    },
  });

  revalidatePath(`/dashboard/sessions/${existing.id}`);
  revalidatePath(`/dashboard/${existing.projectId}`);
  revalidatePath("/insights");
}

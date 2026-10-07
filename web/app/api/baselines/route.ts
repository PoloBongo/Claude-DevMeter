import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-key";
import { getBaselines } from "@/lib/queries";

function extractApiKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return request.headers.get("x-api-key");
}

/** Per-task-type medians for the collector's `devmeter statusline` (API-key auth, like ingest). */
export async function GET(request: Request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
  if (!user) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  return NextResponse.json({ baselines: await getBaselines(user.id) });
}

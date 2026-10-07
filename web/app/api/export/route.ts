import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getExportRows, type DashboardPeriod } from "@/lib/queries";
import { toCsv } from "@/lib/csv";

const PERIODS: DashboardPeriod[] = ["month", "7", "30", "all", "custom"];

function parseDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** All of the user's sessions as CSV or JSON, with the same project/period filters as /insights. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const periodParam = url.searchParams.get("period");
  const period = PERIODS.find((p) => p === periodParam) ?? "all";

  const rows = await getExportRows(session.user.id, {
    projectId: url.searchParams.get("project") || undefined,
    period,
    customFrom: parseDate(url.searchParams.get("from")),
    customTo: parseDate(url.searchParams.get("to")),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="devmeter-sessions-${stamp}.json"`,
      },
    });
  }

  const header = rows.length > 0 ? Object.keys(rows[0]) : [];
  const csv = toCsv(
    header,
    rows.map((row) => Object.values(row))
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="devmeter-sessions-${stamp}.csv"`,
    },
  });
}

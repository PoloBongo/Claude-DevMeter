import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import type { PricingMode, Session } from "@/generated/prisma/client";
import { convertFromUsd, getUsdToEurRate, type Currency } from "@/lib/currency";
import { IMPORT_TEMPLATES } from "@/lib/imports";
import { cacheRatio, meanOfKnown } from "@/lib/session-metrics";
import { effectiveTaskType, TASK_TYPES, type TaskType } from "@/lib/task-type";

export type DashboardPeriod = "month" | "7" | "30" | "all" | "custom";

export type ProjectSummary = {
  id: string;
  name: string;
  clientName: string | null;
  lastActivity: Date | null;
  periodMinutes: number;
  periodAiCost: number;
  /** Raw token-based estimate, ignoring pricing mode — shown as an FYI next to periodAiCost when they differ. */
  periodAiCostPaygEquivalent: number;
  periodTotalCost: number;
};

export type ProjectOption = { id: string; name: string };

export type BreakEven = {
  subscriptionCost: number;
  paygEquivalent: number;
  reached: boolean;
  delta: number;
};

type Pricing = {
  mode: PricingMode;
  currency: Currency;
  subscriptionCost: number;
  totalMonthTokens: number;
  usdToEurRate: number;
};

function sessionTokens(
  session: Pick<
    Session,
    "tokensInput" | "tokensOutput" | "tokensCacheRead" | "tokensCacheCreation"
  >
): number {
  return (
    session.tokensInput +
    session.tokensOutput +
    session.tokensCacheRead +
    session.tokensCacheCreation
  );
}

function paygEquivalentUsd(
  session: Pick<Session, "estimatedCostUsd">
): number {
  return Number(session.estimatedCostUsd);
}

/**
 * PAYG: the token-based estimate the collector recorded, converted to the display currency.
 * SUBSCRIPTION_FLAT: AI cost is already covered by a flat monthly fee — no marginal cost per session.
 * SUBSCRIPTION_AMORTIZED: spread the flat monthly fee across sessions by their share of that month's tokens.
 * (subscriptionCost is entered directly in the display currency, so it needs no conversion.)
 */
function effectiveSessionCost(
  session: Pick<
    Session,
    "tokensInput" | "tokensOutput" | "tokensCacheRead" | "tokensCacheCreation" | "estimatedCostUsd"
  >,
  pricing: Pricing
): number {
  if (pricing.mode === "SUBSCRIPTION_FLAT") return 0;
  if (pricing.mode === "SUBSCRIPTION_AMORTIZED") {
    if (pricing.totalMonthTokens === 0) return 0;
    return (
      (sessionTokens(session) / pricing.totalMonthTokens) *
      pricing.subscriptionCost
    );
  }
  return convertFromUsd(paygEquivalentUsd(session), pricing.currency, pricing.usdToEurRate);
}

function computeBreakEven(
  pricing: Pricing,
  monthSessions: Pick<Session, "estimatedCostUsd">[]
): BreakEven | null {
  if (pricing.mode === "PAYG" || pricing.subscriptionCost <= 0) return null;

  const paygEquivalent = convertFromUsd(
    monthSessions.reduce((sum, s) => sum + paygEquivalentUsd(s), 0),
    pricing.currency,
    pricing.usdToEurRate
  );

  return {
    subscriptionCost: pricing.subscriptionCost,
    paygEquivalent,
    reached: paygEquivalent >= pricing.subscriptionCost,
    delta: pricing.subscriptionCost - paygEquivalent,
  };
}

export type Budget = {
  amount: number;
  spent: number;
  percentUsed: number;
};

/** Always account-wide (allMonthSessions), independent of the dashboard's project/client filter — a budget isn't scoped to one project. */
function computeBudget(
  pricing: Pricing,
  budgetAmount: number | null,
  allMonthSessions: Pick<
    Session,
    "tokensInput" | "tokensOutput" | "tokensCacheRead" | "tokensCacheCreation" | "estimatedCostUsd"
  >[]
): Budget | null {
  if (budgetAmount === null || budgetAmount <= 0) return null;

  const spent = allMonthSessions.reduce(
    (sum, s) => sum + effectiveSessionCost(s, pricing),
    0
  );

  return { amount: budgetAmount, spent, percentUsed: (spent / budgetAmount) * 100 };
}

export type DailyPoint = {
  date: string;
  hours: number;
  aiCost: number;
};

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Bounds for the dashboard's display period. `start`/`end` are inclusive;
 * null means unbounded on that side. For "custom", `customFrom`/`customTo`
 * are taken as-is (a missing bound is left unbounded) — callers are
 * responsible for validating/parsing them first.
 */
function resolvePeriodRange(
  period: DashboardPeriod,
  customFrom?: Date | null,
  customTo?: Date | null
): { start: Date | null; end: Date | null } {
  if (period === "custom") {
    // customTo is a calendar day picked by the user — extend it to the end
    // of that day so sessions on that day are included.
    const end = customTo ? new Date(customTo) : null;
    if (end) end.setHours(23, 59, 59, 999);
    return { start: customFrom ?? null, end };
  }
  if (period === "all") return { start: null, end: null };
  if (period === "7" || period === "30") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(period));
    return { start: cutoff, end: null };
  }
  return { start: startOfMonth(new Date()), end: null };
}

export function sessionMinutes(
  session: Pick<Session, "startedAt" | "endedAt">
): number {
  if (!session.endedAt) return 0;
  return Math.max(
    0,
    (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000
  );
}

/** The subset of Session fields needed for duration/cost math — lets callers
 *  pass a narrow Prisma `select` result instead of a full row. */
type SessionCostFields = Pick<
  Session,
  | "startedAt"
  | "endedAt"
  | "tokensInput"
  | "tokensOutput"
  | "tokensCacheRead"
  | "tokensCacheCreation"
  | "estimatedCostUsd"
>;

function buildDailySeries(
  sessions: SessionCostFields[],
  days: number,
  pricing: Pricing
): DailyPoint[] {
  const points: DailyPoint[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const daySessions = sessions.filter(
      (s) => s.startedAt >= day && s.startedAt < nextDay
    );

    points.push({
      date: day.toISOString().slice(0, 10),
      hours: daySessions.reduce((sum, s) => sum + sessionMinutes(s), 0) / 60,
      aiCost: daySessions.reduce(
        (sum, s) => sum + effectiveSessionCost(s, pricing),
        0
      ),
    });
  }

  return points;
}

export async function getDashboardData(
  userId: string,
  filter?: {
    projectId?: string;
    client?: string;
    source?: string;
    period?: DashboardPeriod;
    /** Only used when period is "custom". */
    customFrom?: Date | null;
    customTo?: Date | null;
  }
) {
  const user = await requireUser(userId);
  // Only users displaying in EUR ever need the USD->EUR rate, so skip the FX
  // network call entirely for USD accounts, and let it run *alongside* the
  // session queries below rather than blocking them.
  const usdToEurRatePromise: Promise<number> =
    user.currency === "EUR" ? getUsdToEurRate() : Promise.resolve(1);

  const hourlyRate = Number(user.hourlyRate);
  const monthStart = startOfMonth(new Date());
  const period = filter?.period ?? "month";
  const { start: periodStart, end: periodEnd } = resolvePeriodRange(
    period,
    filter?.customFrom,
    filter?.customTo
  );
  const chartCutoff = new Date();
  chartCutoff.setDate(chartCutoff.getDate() - 30);
  chartCutoff.setHours(0, 0, 0, 0);

  // "native" means the collector's own untagged sessions (source is null);
  // anything else matches an import template id (e.g. "clockify").
  const sourceWhere = filter?.source
    ? filter.source === "native"
      ? { source: null }
      : { source: filter.source }
    : {};

  const sessionSelect = {
    projectId: true,
    startedAt: true,
    endedAt: true,
    tokensInput: true,
    tokensOutput: true,
    tokensCacheRead: true,
    tokensCacheCreation: true,
    estimatedCostUsd: true,
  } as const;

  // Only project metadata up front — full history is fetched separately,
  // scoped to whatever date window each figure actually needs, instead of
  // pulling every session the account has ever logged on every load.
  const [allProjectsMeta, hasImportedSessionRow, allMonthSessions] =
    await Promise.all([
      prisma.project.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, clientName: true },
      }),
      prisma.session.findFirst({
        where: { source: { not: null }, project: { userId } },
        select: { id: true },
      }),
      // Pricing denominator (amortization share) + budget/break-even are
      // always account-wide and tied to the real calendar month, regardless
      // of the dashboard's project/client/period filter — a subscription
      // isn't scoped to one project and bills on a real monthly cycle. They
      // do respect the source filter, matching the previous behavior.
      prisma.session.findMany({
        where: {
          project: { userId },
          startedAt: { gte: monthStart },
          ...sourceWhere,
        },
        select: sessionSelect,
      }),
    ]);

  const hasImportedSessions = hasImportedSessionRow !== null;

  const clientOptions = Array.from(
    new Set(
      allProjectsMeta
        .map((p) => p.clientName)
        .filter((name): name is string => Boolean(name))
    )
  ).sort((a, b) => a.localeCompare(b));

  let projectsMeta = filter?.projectId
    ? allProjectsMeta.filter((p) => p.id === filter.projectId)
    : allProjectsMeta;
  if (filter?.client) {
    projectsMeta = projectsMeta.filter((p) => p.clientName === filter.client);
  }
  const projectIds = projectsMeta.map((p) => p.id);

  const usdToEurRate = await usdToEurRatePromise;
  const totalMonthTokens = allMonthSessions.reduce(
    (sum, s) => sum + sessionTokens(s),
    0
  );
  const pricing: Pricing = {
    mode: user.pricingMode,
    currency: user.currency,
    subscriptionCost: Number(user.subscriptionCost ?? 0),
    totalMonthTokens,
    usdToEurRate,
  };

  // `projectId: { in: [] }` correctly matches nothing, so no need to special
  // -case an empty project list here.
  const [periodSessions, chartSessions, lastActivityRows] = await Promise.all(
    [
      prisma.session.findMany({
        where: {
          projectId: { in: projectIds },
          ...sourceWhere,
          ...((periodStart || periodEnd) && {
            startedAt: {
              ...(periodStart ? { gte: periodStart } : {}),
              ...(periodEnd ? { lte: periodEnd } : {}),
            },
          }),
        },
        select: sessionSelect,
      }),
      prisma.session.findMany({
        where: {
          projectId: { in: projectIds },
          ...sourceWhere,
          startedAt: { gte: chartCutoff },
        },
        select: sessionSelect,
      }),
      prisma.session.groupBy({
        by: ["projectId"],
        where: { projectId: { in: projectIds }, ...sourceWhere },
        _max: { startedAt: true },
      }),
    ]
  );

  const lastActivityByProject = new Map(
    lastActivityRows.map((r) => [r.projectId, r._max.startedAt])
  );
  const periodSessionsByProject = new Map<string, typeof periodSessions>();
  for (const s of periodSessions) {
    const list = periodSessionsByProject.get(s.projectId);
    if (list) list.push(s);
    else periodSessionsByProject.set(s.projectId, [s]);
  }

  const projectSummaries: ProjectSummary[] = projectsMeta.map((project) => {
    const sessions = periodSessionsByProject.get(project.id) ?? [];
    const periodMinutes = sessions.reduce(
      (sum, s) => sum + sessionMinutes(s),
      0
    );
    const periodAiCost = sessions.reduce(
      (sum, s) => sum + effectiveSessionCost(s, pricing),
      0
    );
    const periodAiCostPaygEquivalent = convertFromUsd(
      sessions.reduce((sum, s) => sum + paygEquivalentUsd(s), 0),
      pricing.currency,
      pricing.usdToEurRate
    );

    return {
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      lastActivity: lastActivityByProject.get(project.id) ?? null,
      periodMinutes,
      periodAiCost,
      periodAiCostPaygEquivalent,
      periodTotalCost: (periodMinutes / 60) * hourlyRate + periodAiCost,
    };
  });

  return {
    currency: user.currency,
    hourlyRate,
    pricingMode: user.pricingMode,
    projectOptions: allProjectsMeta.map((p): ProjectOption => ({ id: p.id, name: p.name })),
    clientOptions,
    sourceOptions: hasImportedSessions
      ? [
          { value: "native", label: "DevMeter (AI)" },
          ...IMPORT_TEMPLATES.map((t) => ({ value: t.id, label: t.label })),
        ]
      : [],
    projectSummaries,
    period,
    breakEven: computeBreakEven(pricing, allMonthSessions),
    budget: computeBudget(
      pricing,
      user.budgetAmount ? Number(user.budgetAmount) : null,
      allMonthSessions
    ),
    totalPeriodMinutes: projectSummaries.reduce(
      (sum, p) => sum + p.periodMinutes,
      0
    ),
    totalPeriodAiCost: projectSummaries.reduce(
      (sum, p) => sum + p.periodAiCost,
      0
    ),
    totalPeriodAiCostPaygEquivalent: projectSummaries.reduce(
      (sum, p) => sum + p.periodAiCostPaygEquivalent,
      0
    ),
    totalPeriodCost: projectSummaries.reduce(
      (sum, p) => sum + p.periodTotalCost,
      0
    ),
    series: buildDailySeries(chartSessions, 30, pricing),
  };
}

export type SessionFilter = {
  range?: "7" | "30" | "all";
  q?: string;
};

/** Prisma `where` fragment for a project's session list — pushes the range
 *  cutoff and ticket/branch search down to Postgres instead of fetching
 *  every session ever logged and filtering in JS. */
function sessionDbFilter(filter?: SessionFilter) {
  const where: {
    startedAt?: { gte: Date };
    OR?: { ticketRef?: object; gitBranch?: object }[];
  } = {};

  if (filter?.range === "7" || filter?.range === "30") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(filter.range));
    where.startedAt = { gte: cutoff };
  }

  if (filter?.q) {
    where.OR = [
      { ticketRef: { contains: filter.q, mode: "insensitive" } },
      { gitBranch: { contains: filter.q, mode: "insensitive" } },
    ];
  }

  return where;
}

export type ModelCostBucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
};

/** Prisma's Json column comes back as `unknown` — validate the shape the collector writes rather than trust it blindly. */
export function parseModelBreakdown(
  value: unknown
): Record<string, ModelCostBucket> | null {
  if (typeof value !== "object" || value === null) return null;
  const result: Record<string, ModelCostBucket> = {};
  for (const [model, bucket] of Object.entries(value as Record<string, unknown>)) {
    if (typeof bucket !== "object" || bucket === null) continue;
    const b = bucket as Record<string, unknown>;
    if (
      typeof b.input === "number" &&
      typeof b.output === "number" &&
      typeof b.cacheRead === "number" &&
      typeof b.cacheCreation === "number" &&
      typeof b.costUsd === "number"
    ) {
      result[model] = {
        input: b.input,
        output: b.output,
        cacheRead: b.cacheRead,
        cacheCreation: b.cacheCreation,
        costUsd: b.costUsd,
      };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** Plain, client-safe view of a session — functions (sessionCost, etc.) can't cross the server/client boundary. */
export type SessionRowData = {
  id: string;
  startedAt: string;
  ticketRef: string | null;
  gitBranch: string | null;
  durationMinutes: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  cost: number;
  paygCost: number;
  /** Per-model share of `cost`, already converted to the display currency — only set when a session used >1 model. */
  modelCosts: { model: string; cost: number }[] | null;
  taskType: TaskType;
};

export type SessionDayGroup = {
  dateKey: string;
  sessions: SessionRowData[];
};

/** Groups same-calendar-day sessions together, preserving the desc-by-startedAt order rows already arrive in. */
export function groupSessionsByDay(rows: SessionRowData[]): SessionDayGroup[] {
  const order: string[] = [];
  const byDay = new Map<string, SessionRowData[]>();
  for (const row of rows) {
    const dateKey = new Date(row.startedAt).toLocaleDateString("en-CA");
    let bucket = byDay.get(dateKey);
    if (!bucket) {
      bucket = [];
      byDay.set(dateKey, bucket);
      order.push(dateKey);
    }
    bucket.push(row);
  }
  return order.map((dateKey) => ({ dateKey, sessions: byDay.get(dateKey)! }));
}

/**
 * `filter` narrows the fetched sessions at the DB level (range cutoff +
 * ticket/branch search) instead of pulling the project's entire session
 * history on every load — pass the same range/q the page is about to
 * display with.
 */
export async function getProjectDetail(
  userId: string,
  projectId: string,
  filter?: SessionFilter
) {
  const user = await requireUser(userId);
  // Only users displaying in EUR ever need the USD->EUR rate — skip the FX
  // network call for USD accounts, and run it alongside the DB queries
  // rather than blocking on it first.
  const usdToEurRatePromise: Promise<number> =
    user.currency === "EUR" ? getUsdToEurRate() : Promise.resolve(1);

  const hourlyRate = Number(user.hourlyRate);
  const monthStart = startOfMonth(new Date());

  const [project, monthTokensAgg, usdToEurRate] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        sessions: {
          orderBy: { startedAt: "desc" },
          where: sessionDbFilter(filter),
        },
      },
    }),
    // Pricing denominator: always account-wide (every project of this
    // user), tied to the real calendar month — a subscription bills
    // monthly regardless of which project or range is being viewed.
    prisma.session.aggregate({
      where: { project: { userId }, startedAt: { gte: monthStart } },
      _sum: {
        tokensInput: true,
        tokensOutput: true,
        tokensCacheRead: true,
        tokensCacheCreation: true,
      },
    }),
    usdToEurRatePromise,
  ]);

  if (!project) return null;

  const totalMonthTokens =
    (monthTokensAgg._sum.tokensInput ?? 0) +
    (monthTokensAgg._sum.tokensOutput ?? 0) +
    (monthTokensAgg._sum.tokensCacheRead ?? 0) +
    (monthTokensAgg._sum.tokensCacheCreation ?? 0);

  const pricing: Pricing = {
    mode: user.pricingMode,
    currency: user.currency,
    subscriptionCost: Number(user.subscriptionCost ?? 0),
    totalMonthTokens,
    usdToEurRate,
  };

  return {
    project,
    currency: user.currency,
    hourlyRate,
    pricingMode: user.pricingMode,
    sessionMinutes,
    sessionCost: (session: Session) => effectiveSessionCost(session, pricing),
    sessionCostPaygEquivalent: (session: Session) =>
      convertFromUsd(paygEquivalentUsd(session), pricing.currency, pricing.usdToEurRate),
    convertUsd: (usd: number) => convertFromUsd(usd, pricing.currency, pricing.usdToEurRate),
  };
}

export type OrgMemberStat = {
  userId: string;
  email: string;
  joinedAt: Date;
  currency: Currency;
  monthMinutes: number;
  monthAiCost: number;
  monthTotalCost: number;
};

/**
 * Admin-only rollup for enterprise mode. Reuses getDashboardData per member
 * rather than re-deriving the aggregation — each member keeps their own
 * rate/currency/pricing settings, so there's deliberately no cross-member
 * currency conversion or combined grand total here (see plan notes).
 */
export async function getOrgMemberStats(
  organizationId: string
): Promise<OrgMemberStat[]> {
  const members = await prisma.user.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });

  return Promise.all(
    members.map(async (member) => {
      const data = await getDashboardData(member.id);
      return {
        userId: member.id,
        email: member.email,
        joinedAt: member.createdAt,
        currency: data.currency,
        monthMinutes: data.totalPeriodMinutes,
        monthAiCost: data.totalPeriodAiCost,
        monthTotalCost: data.totalPeriodCost,
      };
    })
  );
}

/** Everything needed to turn a raw session row into a display-currency cost, loaded once per page. */
async function getPricingContext(userId: string) {
  const user = await requireUser(userId);
  const monthStart = startOfMonth(new Date());
  const [monthTokensAgg, usdToEurRate] = await Promise.all([
    prisma.session.aggregate({
      where: { project: { userId }, startedAt: { gte: monthStart } },
      _sum: {
        tokensInput: true,
        tokensOutput: true,
        tokensCacheRead: true,
        tokensCacheCreation: true,
      },
    }),
    user.currency === "EUR" ? getUsdToEurRate() : Promise.resolve(1),
  ]);
  const pricing: Pricing = {
    mode: user.pricingMode,
    currency: user.currency,
    subscriptionCost: Number(user.subscriptionCost ?? 0),
    totalMonthTokens:
      (monthTokensAgg._sum.tokensInput ?? 0) +
      (monthTokensAgg._sum.tokensOutput ?? 0) +
      (monthTokensAgg._sum.tokensCacheRead ?? 0) +
      (monthTokensAgg._sum.tokensCacheCreation ?? 0),
    usdToEurRate,
  };
  return { user, pricing };
}

/** One session (owner-checked) with its project, for the detail page. */
export async function getSessionDetail(userId: string, sessionId: string) {
  const [session, { user, pricing }] = await Promise.all([
    prisma.session.findFirst({
      where: { id: sessionId, project: { userId } },
      include: { project: { select: { id: true, name: true } } },
    }),
    getPricingContext(userId),
  ]);
  if (!session) return null;

  return {
    session,
    currency: user.currency,
    pricingMode: user.pricingMode,
    cost: effectiveSessionCost(session, pricing),
    paygCost: convertFromUsd(paygEquivalentUsd(session), pricing.currency, pricing.usdToEurRate),
    durationMinutes: sessionMinutes(session),
    cacheRatio: cacheRatio(session),
    taskType: effectiveTaskType(session),
  };
}

export type InsightSession = {
  id: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  ticketRef: string | null;
  gitBranch: string | null;
  taskType: TaskType;
  cost: number;
  promptCount: number | null;
  cacheRatio: number | null;
  committed: boolean | null;
};

export type TaskTypeStat = {
  taskType: TaskType;
  sessions: number;
  avgCost: number;
  avgPrompts: number | null;
  /** How many of `sessions` actually reported a prompt count; the average only covers those. */
  promptSamples: number;
  avgCacheRatio: number | null;
  cacheSamples: number;
};

export type PromptTrendPoint = {
  id: string;
  date: string;
  prompts: number;
  taskType: TaskType;
};

export type InsightsFilter = {
  projectId?: string;
  period?: DashboardPeriod;
  customFrom?: Date | null;
  customTo?: Date | null;
};

const TOP_N = 10;

export async function getInsightsData(userId: string, filter?: InsightsFilter) {
  const { user, pricing } = await getPricingContext(userId);
  const period = filter?.period ?? "month";
  const { start, end } = resolvePeriodRange(period, filter?.customFrom, filter?.customTo);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  const select = {
    id: true,
    projectId: true,
    project: { select: { name: true } },
    startedAt: true,
    endedAt: true,
    ticketRef: true,
    gitBranch: true,
    taskType: true,
    tokensInput: true,
    tokensOutput: true,
    tokensCacheRead: true,
    tokensCacheCreation: true,
    estimatedCostUsd: true,
    promptCount: true,
    commitCount: true,
  } as const;
  const projectWhere = {
    project: { userId },
    ...(filter?.projectId ? { projectId: filter.projectId } : {}),
  };

  const [projects, periodRows, weekRows] = await Promise.all([
    prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.session.findMany({
      where: {
        ...projectWhere,
        // Imported sessions (Clockify etc.) carry no tokens or signals: keep the analysis to native ones.
        source: null,
        ...((start || end) && {
          startedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) },
        }),
      },
      orderBy: { startedAt: "asc" },
      select,
    }),
    prisma.session.findMany({
      where: { ...projectWhere, source: null, startedAt: { gte: weekStart } },
      select,
    }),
  ]);

  const toInsight = (row: (typeof periodRows)[number]): InsightSession => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    startedAt: row.startedAt.toISOString(),
    ticketRef: row.ticketRef,
    gitBranch: row.gitBranch,
    taskType: effectiveTaskType(row),
    cost: effectiveSessionCost(row, pricing),
    promptCount: row.promptCount,
    cacheRatio: cacheRatio(row),
    committed: row.commitCount === null ? null : row.commitCount > 0,
  });

  const sessions = periodRows.map(toInsight);

  const byType: TaskTypeStat[] = TASK_TYPES.map((taskType) => {
    const group = sessions.filter((s) => s.taskType === taskType);
    const prompts = meanOfKnown(group.map((s) => s.promptCount));
    const cache = meanOfKnown(group.map((s) => s.cacheRatio));
    return {
      taskType,
      sessions: group.length,
      avgCost: group.length > 0 ? group.reduce((sum, s) => sum + s.cost, 0) / group.length : 0,
      avgPrompts: prompts.mean,
      promptSamples: prompts.n,
      avgCacheRatio: cache.mean,
      cacheSamples: cache.n,
    };
  }).filter((stat) => stat.sessions > 0);

  const week = weekRows.map(toInsight);
  const mostExpensive = [...week].sort((a, b) => b.cost - a.cost).slice(0, TOP_N);
  const chattiest = week
    .filter((s) => s.promptCount !== null && s.promptCount > 0)
    .sort((a, b) => (b.promptCount ?? 0) - (a.promptCount ?? 0))
    .slice(0, TOP_N);

  // "Successful" = at least one commit. Sessions without a prompt count or
  // commit signal (older collectors) can't be classified, so they are left out.
  const successfulTrend: PromptTrendPoint[] = sessions
    .filter((s) => s.committed === true && s.promptCount !== null)
    .map((s) => ({
      id: s.id,
      date: s.startedAt.slice(0, 10),
      prompts: s.promptCount ?? 0,
      taskType: s.taskType,
    }));

  return {
    currency: user.currency,
    projectOptions: projects.map((p): ProjectOption => ({ id: p.id, name: p.name })),
    period,
    sessionCount: sessions.length,
    sessionsWithSignals: sessions.filter((s) => s.promptCount !== null).length,
    byType,
    mostExpensive,
    chattiest,
    successfulTrend,
  };
}

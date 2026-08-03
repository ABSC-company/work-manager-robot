import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { getZonedParts, startOfDayInZone } from "../utils/time";
import { decryptSecret } from "../utils/crypto";
import { hasJiraActivity, fetchAssigneeBacklog, resolveAccountIdByName } from "../integrations/jira/service";
import { fetchCommitsForPeriod } from "../integrations/github/service";

// Runs once per company per day, shortly after local midnight, evaluating the day that just ended.
const IDLE_CHECK_HOUR = 0;
const IDLE_CHECK_MINUTE = 30;

type EvalResult = "recorded" | "had_activity" | "already_recorded" | "no_directions";
export type IdleTrackingTally = Record<EvalResult, number>;

const emptyTally = (): IdleTrackingTally => ({ recorded: 0, had_activity: 0, already_recorded: 0, no_directions: 0 });

type CompanyWithEmployees = Awaited<ReturnType<typeof loadCompany>>;

function loadCompany(companyId: string) {
  return prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: { employees: { include: { directions: { include: { direction: true } } } } },
  });
}

/** For each employee with no detected Jira/GitHub activity yesterday, records a persistent IdlePeriod row
 * with an inferred reason ("no backlog tasks" vs. "had tasks but did nothing detectable"). Runs once per
 * company per day, at IDLE_CHECK_HOUR:IDLE_CHECK_MINUTE in the company's own timezone. */
export async function checkIdleTracking(now: Date): Promise<void> {
  const companies = await prisma.company.findMany({
    include: { employees: { include: { directions: { include: { direction: true } } } } },
  });

  for (const company of companies) {
    const tz = company.timezone;
    const parts = getZonedParts(now, tz);
    if (parts.hour !== IDLE_CHECK_HOUR || parts.minute !== IDLE_CHECK_MINUTE) continue;

    const todayStart = startOfDayInZone(now, tz);
    const dayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const dayEnd = todayStart;

    const tally = await evaluateCompanyDay(company, dayStart, dayEnd);
    logger.info({ companyId: company.id, day: dayStart.toISOString().slice(0, 10), ...tally }, "idle tracking: scheduled run done");
  }
}

/** Manual trigger (e.g. an admin bot command) that evaluates a specific company's PREVIOUS calendar day
 * right now, bypassing the once-a-day time gate — useful to verify the feature without waiting for midnight. */
export async function runIdleTrackingNow(companyId: string): Promise<IdleTrackingTally> {
  const company = await loadCompany(companyId);
  const todayStart = startOfDayInZone(new Date(), company.timezone);
  const dayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const dayEnd = todayStart;

  const tally = await evaluateCompanyDay(company, dayStart, dayEnd);
  logger.info({ companyId, day: dayStart.toISOString().slice(0, 10), ...tally }, "idle tracking: manual run done");
  return tally;
}

async function evaluateCompanyDay(company: CompanyWithEmployees, dayStart: Date, dayEnd: Date): Promise<IdleTrackingTally> {
  const jiraCreds =
    company.jiraBaseUrl && company.jiraEmail && company.jiraApiToken
      ? { baseUrl: company.jiraBaseUrl, email: company.jiraEmail, apiToken: decryptSecret(company.jiraApiToken) }
      : null;
  const githubToken = company.githubToken ? decryptSecret(company.githubToken) : null;

  const tally = emptyTally();

  for (const employee of company.employees) {
    try {
      const result = await evaluateEmployeeDay(employee, { jiraCreds, githubToken, dayStart, dayEnd });
      tally[result]++;
    } catch (err) {
      logger.error({ err, employeeId: employee.id, companyId: company.id }, "idle tracking failed for employee");
    }
  }

  return tally;
}

async function evaluateEmployeeDay(
  employee: {
    id: string;
    fullName: string;
    jiraAccountId: string | null;
    githubUsername: string | null;
    directions: { direction: { jiraProjectKey: string | null; githubRepos: string[] } }[];
  },
  ctx: {
    jiraCreds: { baseUrl: string; email: string; apiToken: string } | null;
    githubToken: string | null;
    dayStart: Date;
    dayEnd: Date;
  }
): Promise<EvalResult> {
  const existing = await prisma.idlePeriod.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: ctx.dayStart } },
  });
  if (existing) return "already_recorded";

  const directions = employee.directions.map((d) => d.direction);
  if (directions.length === 0) return "no_directions"; // not assigned anywhere — nothing meaningful to evaluate

  let accountId = employee.jiraAccountId;
  let hadActivity = false;

  if (ctx.jiraCreds) {
    if (!accountId) accountId = await resolveAccountIdByName(ctx.jiraCreds, employee.fullName);
    if (accountId) {
      hadActivity = await hasJiraActivity(ctx.jiraCreds, { assigneeAccountId: accountId, start: ctx.dayStart, end: ctx.dayEnd });
    }
  }

  if (!hadActivity && ctx.githubToken && employee.githubUsername) {
    const repos = [...new Set(directions.flatMap((d) => d.githubRepos))];
    for (const repo of repos) {
      const commits = await fetchCommitsForPeriod(ctx.githubToken, {
        repo,
        start: ctx.dayStart,
        end: ctx.dayEnd,
        authorUsername: employee.githubUsername,
      });
      if (commits.length > 0) {
        hadActivity = true;
        break;
      }
    }
  }

  if (hadActivity) return "had_activity";

  let hasBacklog = false;
  if (ctx.jiraCreds && accountId) {
    for (const direction of directions) {
      if (!direction.jiraProjectKey) continue;
      const backlog = await fetchAssigneeBacklog(ctx.jiraCreds, { projectKey: direction.jiraProjectKey, assigneeAccountId: accountId });
      if (backlog.length > 0) {
        hasBacklog = true;
        break;
      }
    }
  }

  await prisma.idlePeriod.create({
    data: {
      employeeId: employee.id,
      date: ctx.dayStart,
      hours: 8,
      reason: hasBacklog ? "NO_ACTIVITY" : "NO_BACKLOG_TASKS",
      note: hasBacklog
        ? "За день не зафиксировано активности в Jira/GitHub при наличии задач в беклоге — точная причина не определена (отпуск, больничный, работа вне отслеживаемых систем и т.п.)."
        : "В беклоге сотрудника не было доступных задач.",
    },
  });

  return "recorded";
}

import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { getZonedParts, startOfDayInZone } from "../utils/time";
import { decryptSecret } from "../utils/crypto";
import { hasJiraActivity, fetchAssigneeBacklog, resolveAccountIdByName } from "../integrations/jira/service";
import { fetchCommitsForPeriod } from "../integrations/github/service";

// Runs once per company per day, shortly after local midnight, evaluating the day that just ended.
const IDLE_CHECK_HOUR = 0;
const IDLE_CHECK_MINUTE = 30;

/** For each employee with no detected Jira/GitHub activity yesterday, records a persistent IdlePeriod row
 * with an inferred reason ("no backlog tasks" vs. "had tasks but did nothing detectable"). */
export async function checkIdleTracking(now: Date): Promise<void> {
  const companies = await prisma.company.findMany({
    include: {
      employees: { include: { directions: { include: { direction: true } } } },
    },
  });

  for (const company of companies) {
    const tz = company.timezone;
    const parts = getZonedParts(now, tz);
    if (parts.hour !== IDLE_CHECK_HOUR || parts.minute !== IDLE_CHECK_MINUTE) continue;

    const todayStart = startOfDayInZone(now, tz);
    const dayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const dayEnd = todayStart;

    const jiraCreds =
      company.jiraBaseUrl && company.jiraEmail && company.jiraApiToken
        ? { baseUrl: company.jiraBaseUrl, email: company.jiraEmail, apiToken: decryptSecret(company.jiraApiToken) }
        : null;
    const githubToken = company.githubToken ? decryptSecret(company.githubToken) : null;

    for (const employee of company.employees) {
      try {
        await evaluateEmployeeDay(employee, { jiraCreds, githubToken, dayStart, dayEnd });
      } catch (err) {
        logger.error({ err, employeeId: employee.id }, "idle tracking failed for employee");
      }
    }
  }
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
): Promise<void> {
  const existing = await prisma.idlePeriod.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: ctx.dayStart } },
  });
  if (existing) return;

  const directions = employee.directions.map((d) => d.direction);
  if (directions.length === 0) return; // not assigned anywhere — nothing meaningful to evaluate

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

  if (hadActivity) return;

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
}

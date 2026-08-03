import { prisma } from "../db/prisma";
import { decryptSecret } from "../utils/crypto";
import { fetchIssuesForPeriod, fetchAssigneeBacklog, resolveAccountIdByName } from "../integrations/jira/service";
import type { JiraIssueSummary } from "../integrations/jira/service";
import { fetchCommitsForPeriod } from "../integrations/github/service";
import type { CommitSummary } from "../integrations/github/service";
import { extractDocumentationText } from "../integrations/ai/documentation";
import { analyzeEmployeeActivity } from "../integrations/ai/analyzer";
import { matchCommitsToIssues } from "../integrations/ai/match";
import { computeEmployeeMetrics, aggregateMetrics, findDoneTimestamp } from "./metrics";
import type { CompanyReportData, DirectionReportBlock, ProjectReportBlock, EmployeeReportBlock, IdleSummary } from "./types";
import type { ReportPeriod } from "@prisma/client";

export async function buildCompanyReportData(opts: {
  companyId: string;
  projectId?: string; // if omitted, includes all company projects
  period: ReportPeriod;
  periodStart: Date;
  periodEnd: Date;
}): Promise<CompanyReportData> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: opts.companyId },
    include: {
      projects: {
        where: opts.projectId ? { id: opts.projectId } : undefined,
        include: {
          directions: {
            include: {
              documentation: true,
              employees: { include: { employee: true } },
            },
          },
        },
      },
    },
  });

  const jiraCreds =
    company.jiraBaseUrl && company.jiraEmail && company.jiraApiToken
      ? {
          baseUrl: company.jiraBaseUrl,
          email: company.jiraEmail,
          apiToken: decryptSecret(company.jiraApiToken),
        }
      : null;
  const githubToken = company.githubToken ? decryptSecret(company.githubToken) : null;
  const periodHours = Math.max((opts.periodEnd.getTime() - opts.periodStart.getTime()) / (1000 * 60 * 60), 0);

  const projectBlocks: ProjectReportBlock[] = [];

  for (const project of company.projects) {
    const directionBlocks: DirectionReportBlock[] = [];

    for (const direction of project.directions) {
      let issues: JiraIssueSummary[] = [];
      if (jiraCreds && direction.jiraProjectKey) {
        issues = await fetchIssuesForPeriod(jiraCreds, {
          projectKey: direction.jiraProjectKey,
          start: opts.periodStart,
          end: opts.periodEnd,
        });
      }

      let commits: CommitSummary[] = [];
      if (githubToken && direction.githubRepos.length > 0) {
        const perRepo = await Promise.all(
          direction.githubRepos.map((repo) =>
            fetchCommitsForPeriod(githubToken, { repo, start: opts.periodStart, end: opts.periodEnd })
          )
        );
        commits = perRepo.flat();
      }

      const documentationText = await extractDocumentationText(direction.documentation, githubToken);

      const employeeBlocks: EmployeeReportBlock[] = [];

      for (const { employee } of direction.employees) {
        let accountId = employee.jiraAccountId;
        if (!accountId && jiraCreds) {
          accountId = await resolveAccountIdByName(jiraCreds, employee.fullName);
          if (accountId) {
            await prisma.employee.update({ where: { id: employee.id }, data: { jiraAccountId: accountId } });
          }
        }

        const employeeIssues = issues.filter(
          (i) =>
            (accountId && i.assigneeAccountId === accountId) ||
            (!accountId && i.assigneeDisplayName === employee.fullName)
        );

        const backlog =
          jiraCreds && accountId && direction.jiraProjectKey
            ? await fetchAssigneeBacklog(jiraCreds, { projectKey: direction.jiraProjectKey, assigneeAccountId: accountId })
            : [];

        const employeeCommits = employee.githubUsername
          ? commits.filter((c) => c.author?.toLowerCase() === employee.githubUsername!.toLowerCase())
          : [];

        const issuesWithCommits = matchCommitsToIssues(employeeIssues, employeeCommits);
        const matchedCommitUrls = new Set(issuesWithCommits.flatMap((i) => i.commits.map((c) => c.url)));
        const unmatchedCommits = employeeCommits.filter((c) => !matchedCommitUrls.has(c.url));

        const metrics = computeEmployeeMetrics(employeeIssues, backlog);
        const idleSummary = await computeIdleSummary(employee.id, opts.periodStart, opts.periodEnd);

        const analysis = await analyzeEmployeeActivity({
          employeeName: employee.fullName,
          periodLabel: formatPeriodLabel(opts.period, opts.periodStart, opts.periodEnd),
          periodHours,
          issues: issuesWithCommits,
          unmatchedCommits,
          idleSummary,
          documentationText,
        });

        const noteByKey = new Map(analysis.perIssue.map((n) => [n.issueKey, n]));
        const commitsByIssueKey = new Map(issuesWithCommits.map((i) => [i.issue.key, i.commits]));

        employeeBlocks.push({
          employeeName: employee.fullName,
          department: employee.department,
          position: employee.position,
          metrics,
          aiSummary: analysis.summary,
          efficiencyAssessment: analysis.efficiencyAssessment,
          estimatedWorkedHours: analysis.estimatedWorkedHours,
          periodHours,
          idleSummary,
          commits: employeeCommits.map((c) => ({ message: c.message, date: c.date, url: c.url })),
          issues: employeeIssues.map((issue) => ({
            key: issue.key,
            summary: issue.summary,
            currentStatus: issue.currentStatus,
            statusHistory: issue.statusHistory,
            durationHours: issueDurationHours(issue),
            commits: (commitsByIssueKey.get(issue.key) ?? []).map((c) => ({ message: c.message, date: c.date, url: c.url })),
            workDoneNote: noteByKey.get(issue.key)?.workDoneNote ?? null,
            followsDocumentation: noteByKey.get(issue.key)?.followsDocumentation ?? null,
          })),
        });
      }

      directionBlocks.push({
        directionName: direction.name,
        employees: employeeBlocks,
        metrics: aggregateMetrics(employeeBlocks.map((e) => e.metrics)),
      });
    }

    projectBlocks.push({
      projectName: project.name,
      directions: directionBlocks,
      metrics: aggregateMetrics(directionBlocks.flatMap((d) => d.employees.map((e) => e.metrics))),
    });
  }

  return {
    companyName: company.name,
    period: opts.period,
    periodLabel: formatPeriodLabel(opts.period, opts.periodStart, opts.periodEnd),
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    projects: projectBlocks,
    overallMetrics: aggregateMetrics(projectBlocks.flatMap((p) => p.directions.flatMap((d) => d.employees.map((e) => e.metrics)))),
  };
}

/** Time from issue creation to completion, in hours. Null if the issue isn't done (yet). */
function issueDurationHours(issue: JiraIssueSummary): number | null {
  const done = findDoneTimestamp(issue);
  if (!done) return null;
  const hours = (done.getTime() - issue.created.getTime()) / (1000 * 60 * 60);
  return hours >= 0 ? hours : null;
}

async function computeIdleSummary(employeeId: string, periodStart: Date, periodEnd: Date): Promise<IdleSummary> {
  const rows = await prisma.idlePeriod.findMany({
    where: { employeeId, date: { gte: periodStart, lte: periodEnd } },
  });
  return {
    totalDays: rows.length,
    totalHours: rows.reduce((sum, r) => sum + r.hours, 0),
    noBacklogDays: rows.filter((r) => r.reason === "NO_BACKLOG_TASKS").length,
    noActivityDays: rows.filter((r) => r.reason === "NO_ACTIVITY").length,
  };
}

function formatPeriodLabel(period: ReportPeriod, start: Date, end: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (period === "DAILY") return `день ${fmt(start)}`;
  if (period === "WEEKLY") return `неделя ${fmt(start)}..${fmt(end)}`;
  if (period === "MONTHLY") return `месяц ${fmt(start)}..${fmt(end)}`;
  return `период ${fmt(start)}..${fmt(end)}`;
}

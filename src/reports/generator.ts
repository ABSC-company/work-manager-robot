import { prisma } from "../db/prisma";
import { decryptSecret } from "../utils/crypto";
import { fetchIssuesForPeriod, fetchAssigneeBacklog, resolveAccountIdByName } from "../integrations/jira/service";
import type { JiraIssueSummary } from "../integrations/jira/service";
import { fetchCommitsForPeriod } from "../integrations/github/service";
import type { CommitSummary } from "../integrations/github/service";
import { extractDocumentationText } from "../integrations/ai/documentation";
import { analyzeEmployeeActivity } from "../integrations/ai/analyzer";
import { matchCommitsToIssues } from "../integrations/ai/match";
import { computeEmployeeMetrics, aggregateMetrics } from "./metrics";
import type { CompanyReportData, DirectionReportBlock, ProjectReportBlock, EmployeeReportBlock } from "./types";
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
      if (githubToken && direction.githubRepo) {
        commits = await fetchCommitsForPeriod(githubToken, {
          repo: direction.githubRepo,
          start: opts.periodStart,
          end: opts.periodEnd,
        });
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

        const metrics = computeEmployeeMetrics(employeeIssues, backlog);

        const analysis = await analyzeEmployeeActivity({
          employeeName: employee.fullName,
          periodLabel: formatPeriodLabel(opts.period, opts.periodStart, opts.periodEnd),
          issues: issuesWithCommits,
          documentationText,
        });

        const noteByKey = new Map(analysis.perIssue.map((n) => [n.issueKey, n]));

        employeeBlocks.push({
          employeeName: employee.fullName,
          department: employee.department,
          position: employee.position,
          metrics,
          aiSummary: analysis.summary,
          issues: employeeIssues.map((issue) => ({
            key: issue.key,
            summary: issue.summary,
            currentStatus: issue.currentStatus,
            statusHistory: issue.statusHistory,
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

function formatPeriodLabel(period: ReportPeriod, start: Date, end: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (period === "DAILY") return `день ${fmt(start)}`;
  if (period === "WEEKLY") return `неделя ${fmt(start)}..${fmt(end)}`;
  return `месяц ${fmt(start)}..${fmt(end)}`;
}

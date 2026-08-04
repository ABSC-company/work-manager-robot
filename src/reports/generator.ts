import { prisma } from "../db/prisma";
import { decryptSecret } from "../utils/crypto";
import { startOfDayInZone } from "../utils/time";
import { fetchIssuesForPeriod, fetchAssigneeBacklog, resolveAccountIdByName } from "../integrations/jira/service";
import type { JiraIssueSummary } from "../integrations/jira/service";
import {
  fetchCommitsForPeriod,
  fetchPullRequestsForPeriod,
  fetchPullRequestReviews,
  fetchPullRequestCommits,
} from "../integrations/github/service";
import type { CommitSummary, PullRequestSummary, PullRequestReviewSummary } from "../integrations/github/service";
import { extractDocumentationText } from "../integrations/ai/documentation";
import { analyzeEmployeeActivity } from "../integrations/ai/analyzer";
import { matchCommitsToIssues, findUnmatchedPullRequests } from "../integrations/ai/match";
import { computeEmployeeMetrics, aggregateMetrics, computeWorkDurationHours } from "./metrics";
import { evaluateEmployeeDay } from "../scheduler/idleScheduler";
import type { IdleEvaluationContext } from "../scheduler/idleScheduler";
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
      let pullRequests: PullRequestSummary[] = [];
      let reviews: PullRequestReviewSummary[] = [];
      let prOriginalCommits: CommitSummary[] = [];
      if (githubToken && direction.githubRepos.length > 0) {
        const perRepo = await Promise.all(
          direction.githubRepos.map(async (repo) => {
            const [repoCommits, repoPrs] = await Promise.all([
              fetchCommitsForPeriod(githubToken, { repo, start: opts.periodStart, end: opts.periodEnd }),
              fetchPullRequestsForPeriod(githubToken, { repo, start: opts.periodStart, end: opts.periodEnd }),
            ]);
            const repoReviews = await fetchPullRequestReviews(githubToken, {
              repo,
              pullRequests: repoPrs,
              start: opts.periodStart,
              end: opts.periodEnd,
            });
            // Original per-PR commits — survive squash-merge + branch deletion, unlike the default
            // branch's commit list (which only ever shows the single squashed commit). This is what
            // lets us attribute a co-author's individual commits inside someone else's PR, and find
            // the real commits behind a squash.
            const repoPrCommits = (
              await Promise.all(repoPrs.map((pr) => fetchPullRequestCommits(githubToken, { repo, number: pr.number })))
            ).flat();
            return { commits: repoCommits, pullRequests: repoPrs, reviews: repoReviews, prCommits: repoPrCommits };
          })
        );
        commits = perRepo.flatMap((r) => r.commits);
        pullRequests = perRepo.flatMap((r) => r.pullRequests);
        reviews = perRepo.flatMap((r) => r.reviews);
        prOriginalCommits = perRepo.flatMap((r) => r.prCommits);
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

        const ghUsername = employee.githubUsername?.toLowerCase() ?? null;
        // Commits authored by this employee — from the default branch (works when squash isn't used)
        // PLUS from any PR's own commit list, regardless of who opened that PR (co-author case).
        const branchCommits = ghUsername ? commits.filter((c) => c.author?.toLowerCase() === ghUsername) : [];
        const prCommitsByEmployee = ghUsername ? prOriginalCommits.filter((c) => c.author?.toLowerCase() === ghUsername) : [];
        const employeeCommits = dedupeBySha([...branchCommits, ...prCommitsByEmployee]);

        const authoredPrs = ghUsername ? pullRequests.filter((pr) => pr.authorLogin?.toLowerCase() === ghUsername) : [];
        const reviewsGiven = ghUsername ? reviews.filter((r) => r.reviewerLogin?.toLowerCase() === ghUsername) : [];
        const pullRequestsMerged = ghUsername ? pullRequests.filter((pr) => pr.mergedByLogin?.toLowerCase() === ghUsername) : [];

        const issuesWithCommits = matchCommitsToIssues(employeeIssues, employeeCommits, pullRequests);
        const matchedCommitShas = new Set(issuesWithCommits.flatMap((i) => i.commits.map((c) => c.sha)));
        const unmatchedCommits = employeeCommits.filter((c) => !matchedCommitShas.has(c.sha));
        const unmatchedPullRequests = findUnmatchedPullRequests(employeeIssues, authoredPrs);

        const metrics = computeEmployeeMetrics(employeeIssues, backlog);
        const idleSummary = await computeIdleSummary(
          employee,
          jiraCreds,
          githubToken,
          company.timezone,
          opts.periodStart,
          opts.periodEnd
        );

        const analysis = await analyzeEmployeeActivity({
          employeeName: employee.fullName,
          periodLabel: formatPeriodLabel(opts.period, opts.periodStart, opts.periodEnd),
          periodHours,
          issues: issuesWithCommits,
          unmatchedCommits,
          unmatchedPullRequests,
          reviewsGiven,
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
          reviewsGiven: reviewsGiven.map((r) => ({
            prNumber: r.prNumber,
            prTitle: r.prTitle,
            state: r.state,
            submittedAt: r.submittedAt,
            url: r.url,
          })),
          pullRequestsMerged: pullRequestsMerged.map((pr) => ({ number: pr.number, title: pr.title, url: pr.url })),
          issues: employeeIssues.map((issue) => ({
            key: issue.key,
            summary: issue.summary,
            currentStatus: issue.currentStatus,
            statusHistory: issue.statusHistory,
            durationHours: computeWorkDurationHours(issue),
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

function dedupeBySha(commits: CommitSummary[]): CommitSummary[] {
  return [...new Map(commits.map((c) => [c.sha, c])).values()];
}

/** Idle days are computed and persisted by the daily scheduler (idleScheduler.ts), but a report may cover
 * days that job hasn't run for yet (feature just enabled, server downtime, etc.). Backfill any missing
 * completed day in the period on demand — same logic, same DB row — so the report is never silently missing
 * idle data, and the computation is cached (persisted) for next time. */
async function computeIdleSummary(
  employee: { id: string; fullName: string; jiraAccountId: string | null; githubUsername: string | null },
  jiraCreds: IdleEvaluationContext["jiraCreds"],
  githubToken: string | null,
  companyTimezone: string,
  periodStart: Date,
  periodEnd: Date
): Promise<IdleSummary> {
  const fullEmployee = await prisma.employee.findUniqueOrThrow({
    where: { id: employee.id },
    include: { directions: { include: { direction: true } } },
  });

  const todayStart = startOfDayInZone(new Date(), companyTimezone);
  let day = startOfDayInZone(periodStart, companyTimezone);
  while (day.getTime() < todayStart.getTime() && day.getTime() < periodEnd.getTime()) {
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const existing = await prisma.idlePeriod.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: day } },
    });
    if (!existing) {
      await evaluateEmployeeDay(fullEmployee, { jiraCreds, githubToken, dayStart: day, dayEnd });
    }
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  }

  const rows = await prisma.idlePeriod.findMany({
    where: { employeeId: employee.id, date: { gte: periodStart, lte: periodEnd } },
    orderBy: { date: "asc" },
  });
  return {
    totalDays: rows.length,
    totalHours: rows.reduce((sum, r) => sum + r.hours, 0),
    noBacklogDays: rows.filter((r) => r.reason === "NO_BACKLOG_TASKS").length,
    noActivityDays: rows.filter((r) => r.reason === "NO_ACTIVITY").length,
    periods: rows.map((r) => ({ date: r.date, hours: r.hours, reason: r.reason, note: r.note })),
  };
}

function formatPeriodLabel(period: ReportPeriod, start: Date, end: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (period === "DAILY") return `день ${fmt(start)}`;
  if (period === "WEEKLY") return `неделя ${fmt(start)}..${fmt(end)}`;
  if (period === "MONTHLY") return `месяц ${fmt(start)}..${fmt(end)}`;
  return `период ${fmt(start)}..${fmt(end)}`;
}

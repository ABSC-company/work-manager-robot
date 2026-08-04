import type { JiraIssueSummary } from "../integrations/jira/service";

export interface EmployeeMetrics {
  totalTasks: number;
  completedTasks: number;
  completionPercent: number;
  statusCounts: Record<string, number>;
  avgTaskDurationHours: number | null; // avg time from created to completion, for completed tasks
  avgGapBetweenTasksHours: number | null; // avg gap between finishing one task and starting the next
  hasBacklog: boolean; // whether employee has further open tasks beyond this period (not intentionally idle)
  backlogCount: number;
}

/** Finds when an issue reached a "done" status, based on its status history. Falls back to `updated` if already done but history is empty. */
export function findDoneTimestamp(issue: JiraIssueSummary): Date | null {
  if (issue.statusCategory !== "done") return null;
  // last transition in history should be the one that moved it to done
  const last = issue.statusHistory[issue.statusHistory.length - 1];
  return last ? last.at : issue.updated;
}

// Statuses that mark actual work starting, as opposed to sitting in the backlog. "Task duration" is
// measured from here, not from creation, so backlog wait time never inflates it.
const WORK_START_STATUS_PATTERNS = [/in[\s-]*progress/i, /prototype/i, /в\s*работ/i, /в\s*процесс/i];

/** Finds when an issue first moved into a "work started" status (In Progress / Prototype / etc.), if ever. */
export function findWorkStartTimestamp(issue: JiraIssueSummary): Date | null {
  const transition = issue.statusHistory.find((t) => WORK_START_STATUS_PATTERNS.some((re) => re.test(t.to)));
  return transition ? transition.at : null;
}

/** Time actually spent working an issue: from the "work started" transition to completion. Null if either
 * boundary is unknown — a task that skipped straight to "done" without an observed in-progress transition
 * has no measurable work duration, and must NOT fall back to created→done (that would reintroduce backlog wait). */
export function computeWorkDurationHours(issue: JiraIssueSummary): number | null {
  const start = findWorkStartTimestamp(issue);
  const done = findDoneTimestamp(issue);
  if (!start || !done) return null;
  const hours = (done.getTime() - start.getTime()) / (1000 * 60 * 60);
  return hours >= 0 ? hours : null;
}

export function computeEmployeeMetrics(
  issues: JiraIssueSummary[],
  backlogIssues: JiraIssueSummary[]
): EmployeeMetrics {
  const statusCounts: Record<string, number> = {};
  for (const issue of issues) {
    statusCounts[issue.currentStatus] = (statusCounts[issue.currentStatus] ?? 0) + 1;
  }

  const completed = issues.filter((i) => i.statusCategory === "done");
  const completionPercent = issues.length > 0 ? (completed.length / issues.length) * 100 : 0;

  const durations = completed.map(computeWorkDurationHours).filter((v): v is number => v !== null);

  const avgTaskDurationHours = durations.length > 0 ? average(durations) : null;

  const doneTimestamps = completed
    .map(findDoneTimestamp)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const gaps: number[] = [];
  for (let i = 1; i < doneTimestamps.length; i++) {
    gaps.push((doneTimestamps[i].getTime() - doneTimestamps[i - 1].getTime()) / (1000 * 60 * 60));
  }
  const avgGapBetweenTasksHours = gaps.length > 0 ? average(gaps) : null;

  return {
    totalTasks: issues.length,
    completedTasks: completed.length,
    completionPercent,
    statusCounts,
    avgTaskDurationHours,
    avgGapBetweenTasksHours,
    hasBacklog: backlogIssues.length > 0,
    backlogCount: backlogIssues.length,
  };
}

export interface AggregateMetrics {
  totalTasks: number;
  completedTasks: number;
  completionPercent: number;
  statusCounts: Record<string, number>;
  avgTaskDurationHours: number | null;
  avgGapBetweenTasksHours: number | null;
}

export function aggregateMetrics(all: EmployeeMetrics[]): AggregateMetrics {
  const totalTasks = sum(all.map((m) => m.totalTasks));
  const completedTasks = sum(all.map((m) => m.completedTasks));
  const statusCounts: Record<string, number> = {};
  for (const m of all) {
    for (const [status, count] of Object.entries(m.statusCounts)) {
      statusCounts[status] = (statusCounts[status] ?? 0) + count;
    }
  }
  const durations = all.map((m) => m.avgTaskDurationHours).filter((v): v is number => v !== null);
  const gaps = all.map((m) => m.avgGapBetweenTasksHours).filter((v): v is number => v !== null);

  return {
    totalTasks,
    completedTasks,
    completionPercent: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
    statusCounts,
    avgTaskDurationHours: durations.length > 0 ? average(durations) : null,
    avgGapBetweenTasksHours: gaps.length > 0 ? average(gaps) : null,
  };
}

function average(values: number[]): number {
  return sum(values) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

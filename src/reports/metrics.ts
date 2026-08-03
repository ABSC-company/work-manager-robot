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
function findDoneTimestamp(issue: JiraIssueSummary): Date | null {
  if (issue.statusCategory !== "done") return null;
  // last transition in history should be the one that moved it to done
  const last = issue.statusHistory[issue.statusHistory.length - 1];
  return last ? last.at : issue.updated;
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

  const durations = completed
    .map((issue) => {
      const done = findDoneTimestamp(issue);
      if (!done) return null;
      return (done.getTime() - issue.created.getTime()) / (1000 * 60 * 60);
    })
    .filter((v): v is number => v !== null && v >= 0);

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

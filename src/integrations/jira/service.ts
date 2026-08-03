import { createJiraClient, JiraCredentials } from "./client";
import { logger } from "../../utils/logger";

export interface StatusTransition {
  from: string | null;
  to: string;
  at: Date;
}

export type StatusCategory = "new" | "indeterminate" | "done";

export interface JiraIssueSummary {
  key: string;
  summary: string;
  assigneeAccountId: string | null;
  assigneeDisplayName: string | null;
  currentStatus: string;
  statusCategory: StatusCategory;
  created: Date;
  updated: Date;
  statusHistory: StatusTransition[];
}

/** Fetches all issues in a Jira project/boards updated within [start, end], with status changelog. */
export async function fetchIssuesForPeriod(
  creds: JiraCredentials,
  opts: { projectKey: string; start: Date; end: Date }
): Promise<JiraIssueSummary[]> {
  const client = createJiraClient(creds);
  const jql = `project = "${opts.projectKey}" AND updated >= "${formatJql(opts.start)}" AND updated <= "${formatJql(
    opts.end
  )}" ORDER BY updated ASC`;

  const issues: JiraIssueSummary[] = [];
  let nextPageToken: string | undefined;
  const maxResults = 100;

  for (;;) {
    const page = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
      jql,
      nextPageToken,
      maxResults,
      expand: "changelog",
      fields: ["summary", "assignee", "status", "created", "updated"],
    });

    for (const issue of page.issues ?? []) {
      const histories = (issue as any).changelog?.histories ?? [];
      const statusHistory: StatusTransition[] = [];
      for (const history of histories) {
        for (const item of history.items ?? []) {
          if (item.field === "status") {
            statusHistory.push({
              from: item.fromString ?? null,
              to: item.toString ?? "",
              at: new Date(history.created),
            });
          }
        }
      }
      statusHistory.sort((a, b) => a.at.getTime() - b.at.getTime());

      issues.push({
        key: issue.key,
        summary: issue.fields?.summary ?? "",
        assigneeAccountId: issue.fields?.assignee?.accountId ?? null,
        assigneeDisplayName: issue.fields?.assignee?.displayName ?? null,
        currentStatus: issue.fields?.status?.name ?? "Unknown",
        statusCategory: mapStatusCategory(issue.fields?.status?.statusCategory?.key),
        created: new Date(issue.fields?.created),
        updated: new Date(issue.fields?.updated),
        statusHistory,
      });
    }

    if (!page.nextPageToken || !page.issues || page.issues.length === 0) {
      break;
    }
    nextPageToken = page.nextPageToken;
  }

  return issues;
}

/** Fetches ALL open (non-done-category) issues assigned to a person, regardless of period, to detect backlog. */
export async function fetchAssigneeBacklog(
  creds: JiraCredentials,
  opts: { projectKey: string; assigneeAccountId: string }
): Promise<JiraIssueSummary[]> {
  const client = createJiraClient(creds);
  const jql = `project = "${opts.projectKey}" AND assignee = "${opts.assigneeAccountId}" AND statusCategory != Done ORDER BY updated DESC`;

  try {
    const page = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
      jql,
      maxResults: 50,
      fields: ["summary", "status"],
    });
    return (page.issues ?? []).map((issue) => ({
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      assigneeAccountId: opts.assigneeAccountId,
      assigneeDisplayName: null,
      currentStatus: issue.fields?.status?.name ?? "Unknown",
      statusCategory: "indeterminate" as const,
      created: new Date(),
      updated: new Date(),
      statusHistory: [],
    }));
  } catch (err) {
    logger.warn({ err }, "failed to fetch assignee backlog");
    return [];
  }
}

/** Cheap check for whether an assignee had any Jira activity (status/field updates) in [start, end] — used by the daily idle tracker. */
export async function hasJiraActivity(
  creds: JiraCredentials,
  opts: { assigneeAccountId: string; start: Date; end: Date }
): Promise<boolean> {
  const client = createJiraClient(creds);
  const jql = `assignee = "${opts.assigneeAccountId}" AND updated >= "${formatJql(opts.start)}" AND updated <= "${formatJql(opts.end)}"`;
  try {
    const result = await client.issueSearch.countIssues({ jql });
    return (result.count ?? 0) > 0;
  } catch (err) {
    logger.warn({ err, assigneeAccountId: opts.assigneeAccountId }, "failed to check jira activity");
    return false;
  }
}

/** Resolves a Jira accountId by matching an employee's full name or username against Jira user search. */
export async function resolveAccountIdByName(
  creds: JiraCredentials,
  query: string
): Promise<string | null> {
  const client = createJiraClient(creds);
  try {
    const users = await client.userSearch.findUsers({ query, maxResults: 5 });
    const match = users.find(
      (u) => u.displayName?.toLowerCase().trim() === query.toLowerCase().trim()
    );
    return (match ?? users[0])?.accountId ?? null;
  } catch (err) {
    logger.warn({ err, query }, "failed to resolve jira accountId");
    return null;
  }
}

export interface JiraUserCandidate {
  accountId: string;
  displayName: string;
  email: string | null;
}

/** Searches Jira users by name/email so an admin can pick the correct account explicitly. */
export async function searchJiraUsers(
  creds: JiraCredentials,
  query: string
): Promise<JiraUserCandidate[]> {
  const client = createJiraClient(creds);
  try {
    const users = await client.userSearch.findUsers({ query, maxResults: 10 });
    return users
      .filter((u) => u.accountId)
      .map((u) => ({
        accountId: u.accountId!,
        displayName: u.displayName ?? "(без имени)",
        email: (u as any).emailAddress ?? null,
      }));
  } catch (err) {
    logger.warn({ err, query }, "failed to search jira users");
    return [];
  }
}

function mapStatusCategory(key: string | undefined): StatusCategory {
  if (key === "done") return "done";
  if (key === "new") return "new";
  return "indeterminate";
}

function formatJql(date: Date): string {
  // Jira JQL date format: yyyy-MM-dd HH:mm
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

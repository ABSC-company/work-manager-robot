import type { CommitSummary } from "../github/service";
import type { JiraIssueSummary } from "../jira/service";
import type { IssueWithCommits } from "./analyzer";

/** Matches GitHub commits to Jira issues by looking for the issue key in the commit message. */
export function matchCommitsToIssues(
  issues: JiraIssueSummary[],
  commits: CommitSummary[]
): IssueWithCommits[] {
  return issues.map((issue) => ({
    issue,
    commits: commits.filter((c) => c.message.toUpperCase().includes(issue.key.toUpperCase())),
  }));
}

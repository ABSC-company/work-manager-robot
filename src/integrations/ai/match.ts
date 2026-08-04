import type { CommitSummary, PullRequestSummary } from "../github/service";
import type { JiraIssueSummary } from "../jira/service";
import type { IssueWithCommits } from "./analyzer";

/**
 * Matches GitHub commits to Jira issues:
 * 1. Literal issue key in the commit message.
 * 2. The commit belongs to a PR (via `commit.prNumber`, populated from the PR Commits API — this survives
 *    squash-merge + branch deletion) whose branch name or title references the issue key. A repo linked to
 *    Jira conventionally names branches after the issue key, so this is the primary, reliable signal once
 *    commits get squashed into one on merge.
 * 3. Fallback: the squash-merge commit on the default branch, found via its default `"... (#123)"` message
 *    GitHub appends — kept in case the PR Commits API had nothing (e.g. a very old, since-deleted PR).
 */
export function matchCommitsToIssues(
  issues: JiraIssueSummary[],
  commits: CommitSummary[],
  pullRequests: PullRequestSummary[] = []
): IssueWithCommits[] {
  return issues.map((issue) => {
    const keyUpper = issue.key.toUpperCase();

    const matchingPrNumbers = new Set(
      pullRequests
        .filter((pr) => pr.headRefName.toUpperCase().includes(keyUpper) || pr.title.toUpperCase().includes(keyUpper))
        .map((pr) => pr.number)
    );

    const matched = commits.filter(
      (c) =>
        c.message.toUpperCase().includes(keyUpper) ||
        (c.prNumber !== undefined && matchingPrNumbers.has(c.prNumber)) ||
        [...matchingPrNumbers].some((num) => c.message.includes(`(#${num})`))
    );

    const bySha = new Map(matched.map((c) => [c.sha, c]));
    return { issue, commits: [...bySha.values()] };
  });
}

/** PRs whose branch/title didn't reference any known issue key — passed to the AI as a fuzzy-matching
 * fallback (compared against issue summaries / direction documentation) since a deterministic match failed. */
export function findUnmatchedPullRequests(issues: JiraIssueSummary[], pullRequests: PullRequestSummary[]): PullRequestSummary[] {
  const keys = issues.map((i) => i.key.toUpperCase());
  return pullRequests.filter((pr) => !keys.some((key) => pr.headRefName.toUpperCase().includes(key) || pr.title.toUpperCase().includes(key)));
}

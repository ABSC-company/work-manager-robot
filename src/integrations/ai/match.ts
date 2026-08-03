import type { CommitSummary, PullRequestSummary } from "../github/service";
import type { JiraIssueSummary } from "../jira/service";
import type { IssueWithCommits } from "./analyzer";

/**
 * Matches GitHub commits to Jira issues two ways:
 * 1. Literal issue key in the commit message (works when squash-merge isn't used, or the message keeps it).
 * 2. Issue key in the PR's branch name or title — when a repo is squash-merged, individual commits vanish
 *    into one squash commit on the default branch, whose message GitHub sets to `${prTitle} (#${prNumber})`
 *    by default. So a branch/title match on the PR pulls in that squash commit via the "(#123)" marker.
 */
export function matchCommitsToIssues(
  issues: JiraIssueSummary[],
  commits: CommitSummary[],
  pullRequests: PullRequestSummary[] = []
): IssueWithCommits[] {
  return issues.map((issue) => {
    const keyUpper = issue.key.toUpperCase();

    const directCommits = commits.filter((c) => c.message.toUpperCase().includes(keyUpper));

    const matchingPrNumbers = pullRequests
      .filter((pr) => pr.headRefName.toUpperCase().includes(keyUpper) || pr.title.toUpperCase().includes(keyUpper))
      .map((pr) => pr.number);

    const squashCommits = commits.filter((c) => matchingPrNumbers.some((num) => c.message.includes(`(#${num})`)));

    const bySha = new Map([...directCommits, ...squashCommits].map((c) => [c.sha, c]));

    return { issue, commits: [...bySha.values()] };
  });
}

/** PRs whose branch/title didn't reference any known issue key — passed to the AI as a fuzzy-matching
 * fallback (compared against issue summaries / direction documentation) since a deterministic match failed. */
export function findUnmatchedPullRequests(issues: JiraIssueSummary[], pullRequests: PullRequestSummary[]): PullRequestSummary[] {
  const keys = issues.map((i) => i.key.toUpperCase());
  return pullRequests.filter((pr) => !keys.some((key) => pr.headRefName.toUpperCase().includes(key) || pr.title.toUpperCase().includes(key)));
}

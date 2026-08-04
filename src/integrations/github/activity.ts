import { fetchCommitsForPeriod, fetchPullRequestsForPeriod, fetchPullRequestCommits, fetchPullRequestReviews } from "./service";

/**
 * True if `username` had ANY GitHub activity in `repo` within [start, end] — used by idle tracking.
 * "Activity" covers more than raw commits on the default branch, which is what the idle detector used
 * to check exclusively (and why it kept marking clearly-active people as idle):
 * - authored a commit, including one that only ever existed inside a PR (co-author on someone else's PR,
 *   or a PR not yet merged — neither shows up in the default branch's commit list)
 * - opened a PR
 * - merged a PR (own or someone else's)
 * - reviewed someone else's PR
 */
export async function hasGithubActivityInRepo(
  token: string,
  opts: { repo: string; username: string; start: Date; end: Date }
): Promise<boolean> {
  const u = opts.username.toLowerCase();

  const commits = await fetchCommitsForPeriod(token, { repo: opts.repo, start: opts.start, end: opts.end, authorUsername: opts.username });
  if (commits.length > 0) return true;

  const prs = await fetchPullRequestsForPeriod(token, { repo: opts.repo, start: opts.start, end: opts.end });
  if (prs.length === 0) return false;

  if (prs.some((pr) => pr.authorLogin?.toLowerCase() === u)) return true;
  if (prs.some((pr) => pr.mergedByLogin?.toLowerCase() === u && pr.mergedAt && pr.mergedAt >= opts.start && pr.mergedAt <= opts.end)) {
    return true;
  }

  const reviews = await fetchPullRequestReviews(token, { repo: opts.repo, pullRequests: prs, start: opts.start, end: opts.end });
  if (reviews.some((r) => r.reviewerLogin?.toLowerCase() === u)) return true;

  for (const pr of prs) {
    const prCommits = await fetchPullRequestCommits(token, { repo: opts.repo, number: pr.number });
    if (prCommits.some((c) => c.author?.toLowerCase() === u && c.date >= opts.start && c.date <= opts.end)) return true;
  }

  return false;
}

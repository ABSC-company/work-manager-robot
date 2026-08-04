import { createGithubClient } from "./client";
import { isGithubNotFound, GITHUB_404_HINT } from "./errors";
import { logger } from "../../utils/logger";

export interface CommitSummary {
  sha: string;
  message: string;
  author: string | null;
  date: Date;
  url: string;
  prNumber?: number; // set when this commit was sourced from a specific PR's own commit list
}

/** Fetches commits in [owner/repo] authored within [start, end], optionally filtered by github username. */
export async function fetchCommitsForPeriod(
  token: string,
  opts: { repo: string; start: Date; end: Date; authorUsername?: string }
): Promise<CommitSummary[]> {
  const [owner, repoName] = opts.repo.split("/");
  if (!owner || !repoName) {
    logger.warn({ repo: opts.repo }, "invalid repo format, expected owner/repo");
    return [];
  }

  const octokit = createGithubClient(token);
  const commits: CommitSummary[] = [];

  try {
    const iterator = octokit.paginate.iterator(octokit.rest.repos.listCommits, {
      owner,
      repo: repoName,
      since: opts.start.toISOString(),
      until: opts.end.toISOString(),
      author: opts.authorUsername,
      per_page: 100,
    });

    for await (const { data } of iterator) {
      for (const commit of data) {
        commits.push({
          sha: commit.sha,
          message: commit.commit.message,
          author: commit.author?.login ?? commit.commit.author?.name ?? null,
          date: new Date(commit.commit.author?.date ?? commit.commit.committer?.date ?? Date.now()),
          url: commit.html_url,
        });
      }
    }
  } catch (err) {
    logger.warn({ err, repo: opts.repo, hint: isGithubNotFound(err) ? GITHUB_404_HINT : undefined }, "failed to fetch github commits");
  }

  return commits;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  headRefName: string; // branch name — usually matches the Jira issue key when a repo is linked to Jira
  authorLogin: string | null;
  merged: boolean;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  mergedByLogin: string | null;
  url: string;
}

/** Fetches PRs in [owner/repo] touched (created/updated/merged/closed) within [start, end]. */
export async function fetchPullRequestsForPeriod(
  token: string,
  opts: { repo: string; start: Date; end: Date }
): Promise<PullRequestSummary[]> {
  const [owner, repoName] = opts.repo.split("/");
  if (!owner || !repoName) {
    logger.warn({ repo: opts.repo }, "invalid repo format, expected owner/repo");
    return [];
  }

  const octokit = createGithubClient(token);
  const pullRequests: PullRequestSummary[] = [];

  try {
    const iterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
      owner,
      repo: repoName,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });

    outer: for await (const { data } of iterator) {
      for (const pr of data) {
        const updatedAt = new Date(pr.updated_at);
        if (updatedAt < opts.start) break outer; // sorted desc by updated_at — nothing older is relevant

        if (updatedAt > opts.end) continue;

        pullRequests.push({
          number: pr.number,
          title: pr.title,
          headRefName: pr.head?.ref ?? "",
          authorLogin: pr.user?.login ?? null,
          merged: pr.merged_at != null,
          createdAt: new Date(pr.created_at),
          updatedAt,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
          mergedByLogin: (pr as { merged_by?: { login?: string } | null }).merged_by?.login ?? null,
          url: pr.html_url,
        });
      }
    }
  } catch (err) {
    logger.warn({ err, repo: opts.repo, hint: isGithubNotFound(err) ? GITHUB_404_HINT : undefined }, "failed to fetch github pull requests");
  }

  return pullRequests;
}

/** Fetches a PR's own original commits (via the PR Commits API), with correct per-author attribution.
 * Unlike the default branch's commit list, this survives squash-merge + branch deletion — GitHub keeps
 * the PR's original commit list available even after the branch that held them is gone. This is what
 * lets us (a) attribute a co-author's individual commits inside someone else's PR, and (b) find the
 * commits behind a squashed merge, which collapses into a single commit on the default branch. */
export async function fetchPullRequestCommits(
  token: string,
  opts: { repo: string; number: number }
): Promise<CommitSummary[]> {
  const [owner, repoName] = opts.repo.split("/");
  if (!owner || !repoName) return [];

  const octokit = createGithubClient(token);
  try {
    const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
      owner,
      repo: repoName,
      pull_number: opts.number,
      per_page: 100,
    });
    return commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login ?? c.commit.author?.name ?? null,
      date: new Date(c.commit.author?.date ?? c.commit.committer?.date ?? Date.now()),
      url: c.html_url,
      prNumber: opts.number,
    }));
  } catch (err) {
    logger.warn({ err, repo: opts.repo, pr: opts.number }, "failed to fetch pull request commits");
    return [];
  }
}

export interface PullRequestReviewSummary {
  prNumber: number;
  prTitle: string;
  reviewerLogin: string | null;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
  submittedAt: Date | null;
  url: string;
}

/** Fetches reviews submitted within [start, end] for the given PRs. One API call per PR — call with an already period-filtered PR list. */
export async function fetchPullRequestReviews(
  token: string,
  opts: { repo: string; pullRequests: PullRequestSummary[]; start: Date; end: Date }
): Promise<PullRequestReviewSummary[]> {
  const [owner, repoName] = opts.repo.split("/");
  if (!owner || !repoName) return [];

  const octokit = createGithubClient(token);
  const reviews: PullRequestReviewSummary[] = [];

  for (const pr of opts.pullRequests) {
    try {
      const { data } = await octokit.rest.pulls.listReviews({ owner, repo: repoName, pull_number: pr.number, per_page: 100 });
      for (const review of data) {
        const submittedAt = review.submitted_at ? new Date(review.submitted_at) : null;
        if (submittedAt && (submittedAt < opts.start || submittedAt > opts.end)) continue;
        reviews.push({
          prNumber: pr.number,
          prTitle: pr.title,
          reviewerLogin: review.user?.login ?? null,
          state: review.state,
          submittedAt,
          url: review.html_url,
        });
      }
    } catch (err) {
      logger.warn({ err, repo: opts.repo, pr: pr.number }, "failed to fetch pull request reviews");
    }
  }

  return reviews;
}

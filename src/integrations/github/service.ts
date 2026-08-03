import { createGithubClient } from "./client";
import { isGithubNotFound, GITHUB_404_HINT } from "./errors";
import { logger } from "../../utils/logger";

export interface CommitSummary {
  sha: string;
  message: string;
  author: string | null;
  date: Date;
  url: string;
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

import { startOfDayInZone } from "../../utils/time";

/**
 * Deterministic, evidence-based estimate of hours an employee spent on GitHub activity in a period —
 * authoring commits/PRs and reviewing others' PRs.
 *
 * This exists because `analyzeEmployeeActivity` (see ../ai/analyzer.ts) used to ask the LLM to invent
 * `estimatedWorkedHours` from bare commit messages and review verdicts, with no signal about how much
 * work any of it actually represented — a one-click "Approve" and a 30-comment review looked identical
 * (just a `state`), and a one-line hotfix and a 2000-line PR looked identical (just a commit message).
 * The model had no basis to say "5 hours" and defaulted to conservative guesses, which is the
 * underestimation this module fixes: it computes a number from actual diff sizes and comment timestamps,
 * and that number becomes a floor under (not a replacement for) the AI's estimate — see generator.ts.
 *
 * Method:
 * 1. Turn every unit of activity (a non-PR commit, an authored PR's diff, a review given, a merge click)
 *    into one timestamped "event" with a size-based effort figure in minutes.
 * 2. Cluster events into work "sessions" — consecutive events with no gap longer than SESSION_GAP_MINUTES
 *    are the same sitting. A session's cost is whichever is larger: the sum of its events' size-based
 *    minutes, or the wall-clock span between its first and last event — plus a fixed ramp-up overhead,
 *    since nobody starts typing the instant they open the editor. This keeps a single huge-diff commit
 *    from being judged only by its (near-zero) wall-clock footprint, while a long back-and-forth review
 *    session isn't judged only by comment count if the comments themselves were small.
 * 3. Bucket sessions into calendar days (company timezone) and cap each day, so a PR left open overnight
 *    between a late-night comment and a next-morning "Approve" can't register as an 8-hour session.
 */

export const SESSION_GAP_MINUTES = 90;
export const SESSION_OVERHEAD_MINUTES = 15;
export const COMMIT_BASE_MINUTES = 10; // flat estimate for a commit we have no diff-size signal for
export const REVIEW_COMMENT_MINUTES = 4; // per inline review comment left
export const REVIEW_MIN_MINUTES = 10; // floor for a review with no comments (e.g. a plain "Approve")
export const REVIEW_MAX_MINUTES = 240;
export const MERGE_ACTION_MINUTES = 8; // clicking "merge" on someone else's already-reviewed PR
export const DAILY_CAP_HOURS = 12;
export const PR_DIFF_MAX_MINUTES = 480;
// minutes ≈ LOC_MINUTES_FACTOR * sqrt(additions + deletions) — sqrt gives diminishing returns so a
// 2000-line diff (mostly generated/moved code, likely) isn't read as literally 100x a 20-line one.
export const LOC_MINUTES_FACTOR = 6;

interface EffortEvent {
  at: Date;
  minutes: number;
  kind: "commit" | "review" | "merge";
}

export interface GithubEffortInput {
  /** Employee's own commits that do NOT belong to any PR in `authoredPrDiffs` — e.g. direct pushes to the
   * default branch. Commits that are part of an authored PR should be left out of this list and instead
   * accounted for once via that PR's diff stats, to avoid counting the same work twice. */
  looseCommits: { date: Date }[];
  /** PRs authored by the employee in the period, with diff-size stats (see fetchPullRequestDiffStats). */
  authoredPrDiffs: { additions: number | null; deletions: number | null; at: Date }[];
  /** This employee's inline review comments on others' PRs, grouped implicitly by prNumber below. */
  reviewComments: { prNumber: number; createdAt: Date }[];
  /** This employee's review "submit" events (state APPROVED / CHANGES_REQUESTED / COMMENTED) on others' PRs. */
  reviewSubmissions: { prNumber: number; submittedAt: Date | null }[];
  /** Timestamps of PRs this employee merged without themselves authoring or reviewing (a plain merge click). */
  mergesWithoutOwnReview: Date[];
  timezone: string;
}

export interface GithubEffortResult {
  totalHours: number; // session-clustered, daily-capped — the number to use as a floor
  /** Rough, uncapped per-kind split of raw event minutes — for display/context only, not additive to totalHours. */
  rawByKind: { commitHours: number; reviewHours: number; mergeHours: number };
  sessionsCount: number;
  cappedDays: number; // calendar days where activity exceeded DAILY_CAP_HOURS (diagnostic)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function estimateGithubEffortHours(input: GithubEffortInput): GithubEffortResult {
  const events: EffortEvent[] = [];

  for (const c of input.looseCommits) {
    events.push({ at: c.date, minutes: COMMIT_BASE_MINUTES, kind: "commit" });
  }

  for (const pr of input.authoredPrDiffs) {
    const loc = (pr.additions ?? 0) + (pr.deletions ?? 0);
    const minutes = loc > 0 ? clamp(LOC_MINUTES_FACTOR * Math.sqrt(loc), COMMIT_BASE_MINUTES, PR_DIFF_MAX_MINUTES) : COMMIT_BASE_MINUTES;
    events.push({ at: pr.at, minutes, kind: "commit" });
  }

  const commentsByPr = new Map<number, { createdAt: Date }[]>();
  for (const c of input.reviewComments) {
    const list = commentsByPr.get(c.prNumber) ?? [];
    list.push({ createdAt: c.createdAt });
    commentsByPr.set(c.prNumber, list);
  }
  for (const sub of input.reviewSubmissions) {
    if (!sub.submittedAt) continue;
    const comments = commentsByPr.get(sub.prNumber) ?? [];
    const minutes = clamp(comments.length * REVIEW_COMMENT_MINUTES, REVIEW_MIN_MINUTES, REVIEW_MAX_MINUTES);
    // Anchor at the latest of (submission, last comment) — comments can be posted after the formal
    // submit event when a reviewer keeps discussing inline after their initial verdict.
    const lastCommentAt = comments.reduce<Date | null>(
      (latest, c) => (!latest || c.createdAt > latest ? c.createdAt : latest),
      null
    );
    const at = lastCommentAt && lastCommentAt > sub.submittedAt ? lastCommentAt : sub.submittedAt;
    events.push({ at, minutes, kind: "review" });
  }

  for (const at of input.mergesWithoutOwnReview) {
    events.push({ at, minutes: MERGE_ACTION_MINUTES, kind: "merge" });
  }

  const rawByKind = { commitHours: 0, reviewHours: 0, mergeHours: 0 };
  for (const e of events) {
    const hours = e.minutes / 60;
    if (e.kind === "commit") rawByKind.commitHours += hours;
    else if (e.kind === "review") rawByKind.reviewHours += hours;
    else rawByKind.mergeHours += hours;
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  const sessions: EffortEvent[][] = [];
  for (const event of events) {
    const current = sessions[sessions.length - 1];
    const prev = current?.[current.length - 1];
    if (prev && event.at.getTime() - prev.at.getTime() <= SESSION_GAP_MINUTES * 60_000) {
      current.push(event);
    } else {
      sessions.push([event]);
    }
  }

  const dailyMinutes = new Map<string, number>();
  for (const session of sessions) {
    const first = session[0];
    const last = session[session.length - 1];
    const spanMinutes = (last.at.getTime() - first.at.getTime()) / 60_000;
    const sizeMinutes = session.reduce((sum, e) => sum + e.minutes, 0);
    const sessionMinutes = Math.max(spanMinutes, sizeMinutes) + SESSION_OVERHEAD_MINUTES;

    // Attribute the whole session to the calendar day of its first event — sessions rarely straddle
    // midnight given the gap threshold, and when they do, splitting hours across two partial days would
    // add complexity this estimate doesn't need to be useful.
    const dayKey = startOfDayInZone(first.at, input.timezone).toISOString();
    dailyMinutes.set(dayKey, (dailyMinutes.get(dayKey) ?? 0) + sessionMinutes);
  }

  let totalHours = 0;
  let cappedDays = 0;
  for (const minutes of dailyMinutes.values()) {
    const hours = minutes / 60;
    if (hours > DAILY_CAP_HOURS) cappedDays++;
    totalHours += Math.min(hours, DAILY_CAP_HOURS);
  }

  return { totalHours, rawByKind, sessionsCount: sessions.length, cappedDays };
}

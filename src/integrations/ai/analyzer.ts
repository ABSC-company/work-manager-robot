import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, AI_MODEL } from "./client";
import { logger } from "../../utils/logger";
import type { JiraIssueSummary } from "../jira/service";
import type { CommitSummary, PullRequestSummary, PullRequestReviewSummary } from "../github/service";

export interface IssueWithCommits {
  issue: JiraIssueSummary;
  commits: CommitSummary[];
}

export interface IdleSummaryInput {
  totalDays: number;
  totalHours: number;
  noBacklogDays: number;
  noActivityDays: number;
  periods: { date: Date; hours: number; reason: "NO_BACKLOG_TASKS" | "NO_ACTIVITY" }[];
}

export interface EmployeeIssueAnalysis {
  issueKey: string;
  workDoneNote: string;
  followsDocumentation: boolean | null; // null when no documentation / no commits to judge
}

export interface EmployeeActivityAnalysis {
  summary: string; // short overview paragraph for the employee, this period
  efficiencyAssessment: string; // judgment combining Jira metrics, GitHub activity, reviews and idle days
  estimatedWorkedHours: number | null; // AI's best estimate of hours actually worked within the period
  perIssue: EmployeeIssueAnalysis[];
}

const FALLBACK_EFFICIENCY = "Автоматическая оценка эффективности временно недоступна.";

/**
 * Uses Claude to turn raw Jira issue + matched/unmatched GitHub commit & PR data + review activity +
 * recorded idle days into a human-readable activity summary and an efficiency assessment, optionally
 * judging alignment with direction documentation.
 */
export async function analyzeEmployeeActivity(input: {
  employeeName: string;
  periodLabel: string; // "day of 2026-07-30", "week of 2026-07-27..08-02", "month of July 2026"
  periodHours: number; // wall-clock length of the report period, in hours
  issues: IssueWithCommits[];
  unmatchedCommits: CommitSummary[]; // commits that couldn't be tied to a specific Jira issue
  unmatchedPullRequests: PullRequestSummary[]; // PRs whose branch/title didn't reference any known issue key
  reviewsGiven: PullRequestReviewSummary[]; // code reviews this employee submitted on others' PRs
  idleSummary: IdleSummaryInput;
  documentationText: string;
}): Promise<EmployeeActivityAnalysis> {
  const hasAnyData =
    input.issues.length > 0 ||
    input.unmatchedCommits.length > 0 ||
    input.unmatchedPullRequests.length > 0 ||
    input.reviewsGiven.length > 0 ||
    input.idleSummary.totalDays > 0;
  if (!hasAnyData) {
    return {
      summary: `${input.employeeName}: активности по задачам за период не зафиксировано.`,
      efficiencyAssessment: "Недостаточно данных (нет задач, коммитов, PR/ревью или записей о простоях) для оценки эффективности за этот период.",
      estimatedWorkedHours: null,
      perIssue: [],
    };
  }

  const issuesPayload = input.issues.map(({ issue, commits }) => ({
    key: issue.key,
    summary: issue.summary,
    currentStatus: issue.currentStatus,
    statusHistory: issue.statusHistory.map((t) => ({ from: t.from, to: t.to, at: t.at.toISOString() })),
    commits: commits.map((c) => ({ message: c.message, date: c.date.toISOString() })),
  }));

  const unmatchedCommitsPayload = input.unmatchedCommits.map((c) => ({ message: c.message, date: c.date.toISOString() }));
  const unmatchedPrPayload = input.unmatchedPullRequests.map((pr) => ({
    branch: pr.headRefName,
    title: pr.title,
    merged: pr.merged,
  }));
  const reviewsPayload = input.reviewsGiven.map((r) => ({ prTitle: r.prTitle, state: r.state, at: r.submittedAt?.toISOString() ?? null }));

  const prompt = `Ты — ассистент менеджера, который готовит отчёт по активности сотрудника "${input.employeeName}" за период: ${input.periodLabel} (~${Math.round(input.periodHours)} ч по календарю).

Ниже приведены задачи Jira этого сотрудника (со сменами статусов) и связанные коммиты GitHub за период.
${input.documentationText ? `Документация направления (для проверки соответствия работы):\n${input.documentationText}\n` : "Документация направления не предоставлена."}

Задачи (JSON):
${JSON.stringify(issuesPayload, null, 2)}

Коммиты, не привязанные к конкретной задаче (JSON):
${JSON.stringify(unmatchedCommitsPayload, null, 2)}

Pull request'ы, чья ветка/название не совпали ни с одним ключом задачи напрямую (JSON) — если по смыслу
название ветки или заголовок PR соответствует какой-то из задач выше (или тому, что описано в документации),
упомяни это предположение в workDoneNote соответствующей задачи с пометкой "предположительно, не подтверждено":
${JSON.stringify(unmatchedPrPayload, null, 2)}

Код-ревью, которые сотрудник провёл на чужих PR за период (JSON):
${JSON.stringify(reviewsPayload, null, 2)}

Зафиксированные простои за период (автоматически определены по отсутствию активности в Jira/GitHub за календарный день):
- всего дней простоя: ${input.idleSummary.totalDays} (~${input.idleSummary.totalHours} ч)
- из них дней без задач в беклоге (простой не по вине сотрудника): ${input.idleSummary.noBacklogDays}
- из них дней с задачами в беклоге, но без видимой активности (причина не зафиксирована — отпуск/больничный/работа вне систем/бездействие): ${input.idleSummary.noActivityDays}
Дни простоя по датам (JSON):
${JSON.stringify(
  input.idleSummary.periods.map((p) => ({ date: p.date.toISOString().slice(0, 10), hours: p.hours, reason: p.reason })),
  null,
  2
)}

Ответь СТРОГО в формате JSON без markdown-обрамления:
{
  "summary": "краткий абзац (3-5 предложений) на русском о том, что сотрудник делал в этот период: задачи, код-ревью чужих PR, прочая GitHub-активность",
  "efficiencyAssessment": "2-4 предложения на русском: оценка эффективности сотрудника за период на основе ВСЕХ данных (задачи Jira, коммиты и PR GitHub, код-ревью, простои). Если активность низкая — укажи наиболее вероятную причину: если есть дни без задач в беклоге — так и скажи; если есть дни с задачами но без активности — явно скажи, что причина не зафиксирована системой и это предположение (например, отпуск/больничный/работа вне отслеживаемых систем)",
  "estimatedWorkedHours": число (приблизительная оценка часов, реально отработанных сотрудником в течение периода, с учётом простоев; не больше длины периода),
  "perIssue": [
    { "issueKey": "KEY-1", "workDoneNote": "1-2 предложения: что конкретно сделано в GitHub по задаче (или 'коммиты не найдены')", "followsDocumentation": true | false | null }
  ]
}
followsDocumentation должен быть null, если документации нет или нет коммитов для сравнения. perIssue может быть пустым массивом, если задач не было.`;

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI response did not contain JSON");

    const parsed = JSON.parse(jsonMatch[0]) as EmployeeActivityAnalysis;
    return parsed;
  } catch (err) {
    logger.error({ err, employee: input.employeeName }, "AI analysis failed, falling back to raw summary");
    return {
      summary: `${input.employeeName}: за период обработано ${input.issues.length} задач(и), ${input.unmatchedCommits.length} коммит(ов) и ${input.reviewsGiven.length} ревью без AI-обработки. Автоматический AI-анализ временно недоступен.`,
      efficiencyAssessment: FALLBACK_EFFICIENCY,
      estimatedWorkedHours: null,
      perIssue: input.issues.map(({ issue }) => ({
        issueKey: issue.key,
        workDoneNote: "AI-анализ недоступен",
        followsDocumentation: null,
      })),
    };
  }
}

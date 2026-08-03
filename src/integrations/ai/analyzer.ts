import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, AI_MODEL } from "./client";
import { logger } from "../../utils/logger";
import type { JiraIssueSummary } from "../jira/service";
import type { CommitSummary } from "../github/service";

export interface IssueWithCommits {
  issue: JiraIssueSummary;
  commits: CommitSummary[];
}

export interface EmployeeIssueAnalysis {
  issueKey: string;
  workDoneNote: string;
  followsDocumentation: boolean | null; // null when no documentation / no commits to judge
}

export interface EmployeeActivityAnalysis {
  summary: string; // short overview paragraph for the employee, this period
  perIssue: EmployeeIssueAnalysis[];
}

/**
 * Uses Claude to turn raw Jira issue + matched GitHub commit data into a human-readable
 * activity summary, optionally judging alignment with direction documentation.
 */
export async function analyzeEmployeeActivity(input: {
  employeeName: string;
  periodLabel: string; // "day of 2026-07-30", "week of 2026-07-27..08-02", "month of July 2026"
  issues: IssueWithCommits[];
  documentationText: string;
}): Promise<EmployeeActivityAnalysis> {
  if (input.issues.length === 0) {
    return { summary: `${input.employeeName}: активности по задачам за период не зафиксировано.`, perIssue: [] };
  }

  const issuesPayload = input.issues.map(({ issue, commits }) => ({
    key: issue.key,
    summary: issue.summary,
    currentStatus: issue.currentStatus,
    statusHistory: issue.statusHistory.map((t) => ({ from: t.from, to: t.to, at: t.at.toISOString() })),
    commits: commits.map((c) => ({ message: c.message, date: c.date.toISOString() })),
  }));

  const prompt = `Ты — ассистент менеджера, который готовит отчёт по активности сотрудника "${input.employeeName}" за период: ${input.periodLabel}.

Ниже приведены задачи Jira этого сотрудника (со сменами статусов) и связанные коммиты GitHub за период.
${input.documentationText ? `Документация направления (для проверки соответствия работы):\n${input.documentationText}\n` : "Документация направления не предоставлена."}

Задачи (JSON):
${JSON.stringify(issuesPayload, null, 2)}

Ответь СТРОГО в формате JSON без markdown-обрамления:
{
  "summary": "краткий абзац (3-5 предложений) на русском о том, что сотрудник делал в этот период, какие задачи закрыл/продвинул",
  "perIssue": [
    { "issueKey": "KEY-1", "workDoneNote": "1-2 предложения: что конкретно сделано в GitHub по задаче (или 'коммиты не найдены')", "followsDocumentation": true | false | null }
  ]
}
followsDocumentation должен быть null, если документации нет или нет коммитов для сравнения.`;

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
      summary: `${input.employeeName}: за период обработано ${input.issues.length} задач(и). Автоматический AI-анализ временно недоступен.`,
      perIssue: input.issues.map(({ issue }) => ({
        issueKey: issue.key,
        workDoneNote: "AI-анализ недоступен",
        followsDocumentation: null,
      })),
    };
  }
}

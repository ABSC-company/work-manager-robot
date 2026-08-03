import { prisma } from "../../db/prisma";
import type { MyContext } from "../instance";

export async function listEmployees(ctx: MyContext): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const employees = await prisma.employee.findMany({ where: { companyId }, orderBy: { fullName: "asc" } });

  if (employees.length === 0) {
    await ctx.reply("В компании пока нет сотрудников.");
    return;
  }

  const lines = employees.map((e) => {
    const jira = e.jiraAccountId ? "✅" : "❌";
    const github = e.githubUsername ? `✅ (@${e.githubUsername})` : "❌";
    return `${e.id}\n  ${e.fullName}${e.position ? ` — ${e.position}` : ""}\n  Jira: ${jira}  GitHub: ${github}`;
  });

  await ctx.reply(
    "Сотрудники и статус сопоставления с Jira/GitHub:\n\n" +
      lines.join("\n\n") +
      "\n\nИспользуйте /mapidentity, чтобы привязать или исправить сопоставление."
  );
}

import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import { decryptSecret } from "../../utils/crypto";
import { searchJiraUsers } from "../../integrations/jira/service";

export async function mapIdentityConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

  const employees = await conversation.external(() => prisma.employee.findMany({ where: { companyId } }));
  if (employees.length === 0) {
    await ctx.reply("В компании пока нет сотрудников. Добавьте через /addemployee.");
    return;
  }

  await ctx.reply(
    "Выберите сотрудника, укажите его id:\n" +
      employees
        .map(
          (e) =>
            `${e.id} — ${e.fullName} (Jira: ${e.jiraAccountId ? "привязан" : "не привязан"}, GitHub: ${
              e.githubUsername ?? "не указан"
            })`
        )
        .join("\n")
  );
  const empMsg = await conversation.waitFor("message:text");
  const employeeId = empMsg.message.text.trim();
  const employee = employees.find((e) => e.id === employeeId);
  if (!employee) {
    await ctx.reply("Сотрудник с таким id не найден. Отменено.");
    return;
  }

  // --- Jira mapping ---
  const company = await conversation.external(() => prisma.company.findUniqueOrThrow({ where: { id: companyId } }));
  const jiraCreds =
    company.jiraBaseUrl && company.jiraEmail && company.jiraApiToken
      ? { baseUrl: company.jiraBaseUrl, email: company.jiraEmail, apiToken: decryptSecret(company.jiraApiToken) }
      : null;

  if (jiraCreds) {
    await ctx.reply(
      `Текущая привязка Jira: ${employee.jiraAccountId ?? "нет"}.\n` +
        "Введите имя/email для поиска в Jira, точный accountId, или '-' чтобы пропустить:"
    );
    const jiraMsg = await conversation.waitFor("message:text");
    const jiraRaw = jiraMsg.message.text.trim();

    if (jiraRaw !== "-") {
      if (/^[0-9a-f]{24}$/i.test(jiraRaw) || jiraRaw.includes(":")) {
        // looks like a raw Jira accountId (Cloud: 24-char hex; Server/DC: often contains ':')
        await conversation.external(() => prisma.employee.update({ where: { id: employee.id }, data: { jiraAccountId: jiraRaw } }));
        await ctx.reply("Jira accountId сохранён напрямую.");
      } else {
        const candidates = await conversation.external(() => searchJiraUsers(jiraCreds, jiraRaw));
        if (candidates.length === 0) {
          await ctx.reply("Пользователи в Jira не найдены по этому запросу. Привязка не изменена.");
        } else {
          await ctx.reply(
            "Найдены пользователи Jira, укажите номер нужного:\n" +
              candidates.map((c, i) => `${i + 1}. ${c.displayName}${c.email ? ` (${c.email})` : ""}`).join("\n")
          );
          const pickMsg = await conversation.waitFor("message:text");
          const idx = Number(pickMsg.message.text.trim()) - 1;
          const picked = candidates[idx];
          if (!picked) {
            await ctx.reply("Некорректный номер. Привязка Jira не изменена.");
          } else {
            await conversation.external(() =>
              prisma.employee.update({ where: { id: employee.id }, data: { jiraAccountId: picked.accountId } })
            );
            await ctx.reply(`Сотрудник привязан к Jira-аккаунту "${picked.displayName}".`);
          }
        }
      }
    }
  } else {
    await ctx.reply("Jira не настроена для компании (см. /setjira) — пропускаю привязку Jira.");
  }

  // --- GitHub mapping ---
  await ctx.reply(`Текущий GitHub username: ${employee.githubUsername ?? "нет"}.\nВведите GitHub username сотрудника, или '-' чтобы пропустить:`);
  const ghMsg = await conversation.waitFor("message:text");
  const ghRaw = ghMsg.message.text.trim();
  if (ghRaw !== "-") {
    await conversation.external(() =>
      prisma.employee.update({ where: { id: employee.id }, data: { githubUsername: ghRaw.replace(/^@/, "") } })
    );
    await ctx.reply(`GitHub username обновлён: ${ghRaw.replace(/^@/, "")}.`);
  }

  await ctx.reply(`Сопоставление для "${employee.fullName}" обновлено.`);
}

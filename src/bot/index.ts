import { createConversation } from "@grammyjs/conversations";
import { bot } from "./instance";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { isSuperAdmin, requireSuperAdmin, requireCompanyAdmin } from "./middleware/auth";
import { newCompanyConversation } from "./conversations/newCompany";
import { addAdminConversation } from "./conversations/addAdmin";
import { addEmployeeConversation } from "./conversations/addEmployee";
import { setJiraConversation, setGithubConversation } from "./conversations/setIntegrations";
import { addProjectConversation, addDirectionConversation } from "./conversations/addProjectDirection";
import { linkDirectionConversation } from "./conversations/linkDirection";
import { setReportConfigConversation, setRequiredApprovalsConversation } from "./conversations/setReportConfig";
import { addOccasionConversation } from "./conversations/addOccasion";
import { mapIdentityConversation } from "./conversations/mapIdentity";
import { listEmployees } from "./conversations/listEmployees";
import { generateCompanyReport } from "../reports/service";
import { sendReportForApproval, registerApproval } from "../reports/dispatch";
import { InlineKeyboard } from "grammy";

bot.use(createConversation(newCompanyConversation, "newCompany"));
bot.use(createConversation(addAdminConversation, "addAdmin"));
bot.use(createConversation(addEmployeeConversation, "addEmployee"));
bot.use(createConversation(setJiraConversation, "setJira"));
bot.use(createConversation(setGithubConversation, "setGithub"));
bot.use(createConversation(addProjectConversation, "addProject"));
bot.use(createConversation(addDirectionConversation, "addDirection"));
bot.use(createConversation(linkDirectionConversation, "linkDirection"));
bot.use(createConversation(setReportConfigConversation, "setReportConfig"));
bot.use(createConversation(setRequiredApprovalsConversation, "setRequiredApprovals"));
bot.use(createConversation(addOccasionConversation, "addOccasion"));
bot.use(createConversation(mapIdentityConversation, "mapIdentity"));

bot.command("start", async (ctx) => {
  const id = String(ctx.from?.id ?? "");
  const admin = isSuperAdmin(id);
  const companyAdminOf = await prisma.companyAdmin.findMany({ where: { telegramId: id }, include: { company: true } });

  let text = "Добро пожаловать в Manager Bot.\n";
  if (admin) text += "Вы супер-администратор сервиса: используйте /newcompany для создания компании.\n";
  if (companyAdminOf.length > 0) {
    text += `Вы администратор компаний: ${companyAdminOf.map((c) => c.company.name).join(", ")}.\n/help — список команд.`;
  }
  await ctx.reply(text);
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "Команды супер-администратора:",
      "/newcompany — создать компанию",
      "",
      "Команды администратора компании:",
      "/selectcompany <id> — выбрать активную компанию (если их несколько)",
      "/addadmin — добавить администратора компании",
      "/addemployee — добавить сотрудника",
      "/listemployees — список сотрудников и статус привязки к Jira/GitHub",
      "/mapidentity — сопоставить сотрудника с его аккаунтом в Jira и/или GitHub",
      "/setjira — привязать Jira-организацию",
      "/setgithub — привязать GitHub-организацию",
      "/addproject — создать проект",
      "/adddirection — создать направление в проекте",
      "/linkdirection — привязать сотрудников/репозиторий/Jira/документацию к направлению",
      "/setreportconfig — настроить расписание отчёта (daily/weekly/monthly)",
      "/setapprovals — задать кол-во требуемых одобрений отчёта",
      "/setgroupchat — привязать текущий чат как групповой (для пересылки отчётов/напоминаний)",
      "/addoccasion — добавить мероприятие/напоминание",
      "/report <daily|weekly|monthly> — сгенерировать отчёт сейчас",
    ].join("\n")
  );
});

bot.command("newcompany", requireSuperAdmin, async (ctx) => {
  await ctx.conversation.enter("newCompany");
});

bot.command("selectcompany", async (ctx) => {
  const companyId = ctx.match?.toString().trim();
  if (!companyId) {
    await ctx.reply("Использование: /selectcompany <id>");
    return;
  }
  const membership = await prisma.companyAdmin.findUnique({
    where: { companyId_telegramId: { companyId, telegramId: String(ctx.from!.id) } },
  });
  if (!membership) {
    await ctx.reply("Вы не администратор этой компании.");
    return;
  }
  ctx.session.activeCompanyId = companyId;
  await ctx.reply("Активная компания выбрана.");
});

bot.command("addadmin", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("addAdmin"));
bot.command("addemployee", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("addEmployee"));
bot.command("setjira", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("setJira"));
bot.command("setgithub", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("setGithub"));
bot.command("addproject", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("addProject"));
bot.command("adddirection", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("addDirection"));
bot.command("linkdirection", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("linkDirection"));
bot.command("setreportconfig", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("setReportConfig"));
bot.command("setapprovals", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("setRequiredApprovals"));
bot.command("addoccasion", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("addOccasion"));
bot.command("mapidentity", requireCompanyAdmin, async (ctx) => ctx.conversation.enter("mapIdentity"));
bot.command("listemployees", requireCompanyAdmin, async (ctx) => listEmployees(ctx));

bot.command("setgroupchat", requireCompanyAdmin, async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply("Выполните эту команду внутри группового чата, который нужно привязать.");
    return;
  }
  await prisma.company.update({
    where: { id: ctx.session.activeCompanyId! },
    data: { groupChatId: String(ctx.chat.id) },
  });
  await ctx.reply("Этот чат привязан для пересылки одобренных отчётов и напоминаний о мероприятиях.");
});

bot.command("report", requireCompanyAdmin, async (ctx) => {
  const periodArg = ctx.match?.toString().trim().toLowerCase();
  const periodMap: Record<string, "DAILY" | "WEEKLY" | "MONTHLY"> = {
    daily: "DAILY",
    weekly: "WEEKLY",
    monthly: "MONTHLY",
  };
  const period = periodMap[periodArg ?? ""];
  if (!period) {
    await ctx.reply("Использование: /report daily|weekly|monthly");
    return;
  }
  await ctx.reply("Формирую отчёт, это может занять некоторое время...");
  try {
    const reportId = await generateCompanyReport(ctx.session.activeCompanyId!, period);
    await sendReportForApproval(reportId);
    await ctx.reply("Отчёт сформирован и отправлен администраторам компании на согласование.");
  } catch (err) {
    logger.error({ err }, "manual report generation failed");
    await ctx.reply("Не удалось сформировать отчёт. Подробности в логах сервиса.");
  }
});

bot.callbackQuery(/^report_approve:(.+)$/, async (ctx) => {
  const reportId = ctx.match[1];
  try {
    const { approvedCount, required, justApproved } = await registerApproval(reportId, String(ctx.from.id));
    const keyboard = new InlineKeyboard().text(`✅ Одобрено (${approvedCount}/${required})`, `report_approve:${reportId}`);
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    await ctx.answerCallbackQuery(
      justApproved ? "Отчёт одобрен и отправлен в групповой чат (если он настроен)." : "Ваше одобрение учтено."
    );
  } catch (err) {
    await ctx.answerCallbackQuery("Только администраторы компании могут одобрять этот отчёт.");
  }
});

bot.catch((err) => {
  logger.error({ err: err.error }, "unhandled bot error");
});

export { bot };

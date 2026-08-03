import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import { generateCompanyReport } from "../../reports/service";
import { sendReportForApproval } from "../../reports/dispatch";
import { zonedTimeToUtc } from "../../utils/time";
import { logger } from "../../utils/logger";
import { waitFor, runCancellable } from "./_helpers";

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

function parseDate(input: string): { day: number; month: number; year: number } | null {
  const m = DATE_RE.exec(input.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return { day, month, year };
}

export async function reportCustomConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  return runCancellable(async () => {
    const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;
    const company = await conversation.external(() => prisma.company.findUniqueOrThrow({ where: { id: companyId } }));

    await ctx.reply("Введите начало периода в формате ДД.ММ.ГГГГ (/cancel — отменить):");
    const startMsg = await waitFor(conversation, ctx, "message:text");
    const startParts = parseDate(startMsg.message.text);
    if (!startParts) {
      await ctx.reply("Некорректная дата. Ожидается формат ДД.ММ.ГГГГ, например 01.07.2026. Отменено.");
      return;
    }

    await ctx.reply("Введите конец периода в формате ДД.ММ.ГГГГ:");
    const endMsg = await waitFor(conversation, ctx, "message:text");
    const endParts = parseDate(endMsg.message.text);
    if (!endParts) {
      await ctx.reply("Некорректная дата. Ожидается формат ДД.ММ.ГГГГ, например 31.07.2026. Отменено.");
      return;
    }

    const start = zonedTimeToUtc(
      { year: startParts.year, month: startParts.month, day: startParts.day, hour: 0, minute: 0 },
      company.timezone
    );
    const end = zonedTimeToUtc(
      { year: endParts.year, month: endParts.month, day: endParts.day, hour: 23, minute: 59 },
      company.timezone
    );

    if (end.getTime() <= start.getTime()) {
      await ctx.reply("Дата конца должна быть позже даты начала. Отменено.");
      return;
    }

    await ctx.reply("Формирую отчёт за указанный период, это может занять некоторое время...");

    try {
      const reportId = await conversation.external(() => generateCompanyReport(companyId, "CUSTOM", new Date(), { start, end }));
      await conversation.external(() => sendReportForApproval(reportId));
      await ctx.reply("Отчёт сформирован и отправлен администраторам компании на согласование.");
    } catch (err) {
      logger.error({ err, companyId }, "custom period report generation failed");
      await ctx.reply("Не удалось сформировать отчёт. Подробности в логах сервиса.");
    }
  });
}

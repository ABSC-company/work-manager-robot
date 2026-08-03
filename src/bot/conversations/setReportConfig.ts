import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import type { ReportPeriod } from "@prisma/client";
import { waitFor, runCancellable } from "./_helpers";

export async function setReportConfigConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  return runCancellable(async () => {
    const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

    await ctx.reply("Какой отчёт настроить? Введите: daily, weekly или monthly (/cancel — отменить)");
    const periodMsg = await waitFor(conversation, ctx, "message:text");
    const periodRaw = periodMsg.message.text.trim().toLowerCase();
    const periodMap: Record<string, ReportPeriod> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };
    const period = periodMap[periodRaw];
    if (!period) {
      await ctx.reply("Некорректный период. Отменено.");
      return;
    }

    await ctx.reply("Введите время отправки в формате ЧЧ:ММ (по таймзоне компании, по умолчанию Asia/Tashkent), например 19:00:");
    const timeMsg = await waitFor(conversation, ctx, "message:text");
    const [hourStr, minuteStr] = timeMsg.message.text.trim().split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr ?? "0");
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      await ctx.reply("Некорректное время. Отменено.");
      return;
    }

    let dayOfWeek: number | undefined;
    let daysBeforeMonthEnd: number | undefined;

    if (period === "WEEKLY") {
      await ctx.reply("В какой день недели отправлять? 0=Вс, 1=Пн ... 6=Сб (по умолчанию 5=Пт):");
      const dowMsg = await waitFor(conversation, ctx, "message:text");
      dayOfWeek = Number(dowMsg.message.text.trim());
      if (Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) dayOfWeek = 5;
    }

    if (period === "MONTHLY") {
      await ctx.reply("За сколько дней до конца месяца отправлять отчёт? (по умолчанию 3):");
      const daysMsg = await waitFor(conversation, ctx, "message:text");
      daysBeforeMonthEnd = Number(daysMsg.message.text.trim());
      if (Number.isNaN(daysBeforeMonthEnd) || daysBeforeMonthEnd < 0) daysBeforeMonthEnd = 3;
    }

    await conversation.external(() =>
      prisma.reportSchedule.upsert({
        where: { companyId_period: { companyId, period } },
        create: { companyId, period, hour, minute, dayOfWeek, daysBeforeMonthEnd, enabled: true },
        update: { hour, minute, dayOfWeek, daysBeforeMonthEnd, enabled: true },
      })
    );

    await ctx.reply(`Расписание для ${periodRaw} отчёта обновлено: ${hour}:${String(minute).padStart(2, "0")}.`);
  });
}

export async function setRequiredApprovalsConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  return runCancellable(async () => {
    const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

    const admins = await conversation.external(() => prisma.companyAdmin.count({ where: { companyId } }));
    await ctx.reply(
      `В компании ${admins} администратор(ов). Введите необходимое количество одобрений для пересылки отчёта в группу (/cancel — отменить):`
    );
    const msg = await waitFor(conversation, ctx, "message:text");
    const required = Number(msg.message.text.trim());
    if (Number.isNaN(required) || required < 1 || required > admins) {
      await ctx.reply(`Некорректное значение. Должно быть от 1 до ${admins}.`);
      return;
    }

    await conversation.external(() => prisma.company.update({ where: { id: companyId }, data: { requiredApprovals: required } }));
    await ctx.reply(`Требуемое количество одобрений установлено: ${required}.`);
  });
}

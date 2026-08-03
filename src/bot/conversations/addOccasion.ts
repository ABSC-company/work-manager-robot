import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import type { RecurrenceFrequency } from "@prisma/client";
import { waitFor, runCancellable } from "./_helpers";

export async function addOccasionConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  return runCancellable(async () => {
  const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

  await ctx.reply("Введите название мероприятия (/cancel — отменить):");
  const titleMsg = await waitFor(conversation, ctx, "message:text");
  const title = titleMsg.message.text.trim();

  await ctx.reply("Введите описание (или '-' чтобы пропустить):");
  const descMsg = await waitFor(conversation, ctx, "message:text");
  const description = descMsg.message.text.trim() === "-" ? null : descMsg.message.text.trim();

  await ctx.reply("Тип мероприятия: 'once' (одноразовое) или 'recurring' (повторяющееся)?");
  const typeMsg = await waitFor(conversation, ctx, "message:text");
  const isOnce = typeMsg.message.text.trim().toLowerCase().startsWith("o");

  await ctx.reply("Введите время в формате ЧЧ:ММ:");
  const timeMsg = await waitFor(conversation, ctx, "message:text");
  const [hourStr, minuteStr] = timeMsg.message.text.trim().split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr ?? "0");

  if (isOnce) {
    await ctx.reply("Введите дату в формате ГГГГ-ММ-ДД:");
    const dateMsg = await waitFor(conversation, ctx, "message:text");
    const [y, m, d] = dateMsg.message.text.trim().split("-").map(Number);
    const scheduledAt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, hour, minute));

    await conversation.external(() =>
      prisma.occasion.create({
        data: { companyId, title, description, type: "ONE_TIME", scheduledAt, hour, minute },
      })
    );
  } else {
    await ctx.reply(
      "Частота повторения:\n" +
        "1 — каждый день\n" +
        "2 — каждую неделю в один или несколько дней (0=Вс..6=Сб)\n" +
        "3 — каждый месяц в определённый день (1-31)\n" +
        "4 — каждый месяц за N дней до конца месяца\n" +
        "Введите номер:"
    );
    const freqMsg = await waitFor(conversation, ctx, "message:text");
    const freqChoice = freqMsg.message.text.trim();

    let frequency: RecurrenceFrequency = "DAILY";
    let daysOfWeek: number[] = [];
    let dayOfMonth: number | undefined;
    let daysBeforeMonthEnd: number | undefined;

    if (freqChoice === "2") {
      frequency = "WEEKLY";
      await ctx.reply("Введите день(и) недели через запятую, если несколько (0=Вс..6=Сб), например 1,3,5:");
      const m = await waitFor(conversation, ctx, "message:text");
      daysOfWeek = m.message.text
        .trim()
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if (daysOfWeek.length === 0) {
        await ctx.reply("Не указано ни одного корректного дня недели. Отменено.");
        return;
      }
    } else if (freqChoice === "3") {
      frequency = "MONTHLY_DAY";
      await ctx.reply("Введите день месяца (1-31):");
      const m = await waitFor(conversation, ctx, "message:text");
      dayOfMonth = Number(m.message.text.trim());
    } else if (freqChoice === "4") {
      frequency = "MONTHLY_BEFORE_END";
      await ctx.reply("Введите число дней до конца месяца:");
      const m = await waitFor(conversation, ctx, "message:text");
      daysBeforeMonthEnd = Number(m.message.text.trim());
    }

    await conversation.external(() =>
      prisma.occasion.create({
        data: {
          companyId,
          title,
          description,
          type: "RECURRING",
          frequency,
          daysOfWeek,
          dayOfMonth,
          daysBeforeMonthEnd,
          hour,
          minute,
        },
      })
    );
  }

  await ctx.reply(`Мероприятие "${title}" создано.`);
  });
}

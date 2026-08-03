import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";

export async function newCompanyConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  await ctx.reply("Введите название новой компании:");
  const nameMsg = await conversation.waitFor("message:text");
  const name = nameMsg.message.text.trim();

  const creatorId = String(ctx.from!.id);
  const creatorName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username;

  const company = await conversation.external(() =>
    prisma.$transaction(async (tx) => {
      const created = await tx.company.create({ data: { name } });
      await tx.companyAdmin.create({
        data: { companyId: created.id, telegramId: creatorId, fullName: creatorName },
      });
      await tx.reportSchedule.createMany({
        data: [
          { companyId: created.id, period: "DAILY", hour: 19, minute: 0 },
          { companyId: created.id, period: "WEEKLY", hour: 19, minute: 0, dayOfWeek: 5 },
          { companyId: created.id, period: "MONTHLY", hour: 19, minute: 0, daysBeforeMonthEnd: 3 },
        ],
      });
      return created;
    })
  );

  ctx.session.activeCompanyId = company.id;

  await ctx.reply(
    `Компания "${company.name}" создана (id: ${company.id}).\n` +
      `Вы назначены её администратором. Настройте интеграции командами /setjira и /setgithub, ` +
      `добавьте сотрудников через /addemployee, проекты через /addproject.`
  );
}

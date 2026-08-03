import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import { waitFor, runCancellable } from "./_helpers";

export async function addAdminConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  return runCancellable(async () => {
    const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

    await ctx.reply("Введите Telegram ID нового администратора (число), или /cancel для отмены:");
    const idMsg = await waitFor(conversation, ctx, "message:text");
    const telegramId = idMsg.message.text.trim();
    if (!/^\d+$/.test(telegramId)) {
      await ctx.reply("Telegram ID должен быть числом. Отменено.");
      return;
    }

    await ctx.reply("Введите полное имя администратора:");
    const nameMsg = await waitFor(conversation, ctx, "message:text");
    const fullName = nameMsg.message.text.trim();

    await conversation.external(() =>
      prisma.companyAdmin.upsert({
        where: { companyId_telegramId: { companyId, telegramId } },
        create: { companyId, telegramId, fullName },
        update: { fullName },
      })
    );

    await ctx.reply(`Администратор "${fullName}" (id ${telegramId}) добавлен в компанию.`);
  });
}

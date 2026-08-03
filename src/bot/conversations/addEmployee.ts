import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import { isUniqueConstraintError } from "../../utils/prismaErrors";
import { waitFor, runCancellable } from "./_helpers";

export async function addEmployeeConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  return runCancellable(async () => {
    const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

    await ctx.reply("Введите @username сотрудника в Telegram (без @), либо '-' если отсутствует. /cancel — отменить:");
    const usernameMsg = await waitFor(conversation, ctx, "message:text");
    const usernameRaw = usernameMsg.message.text.trim().replace(/^@/, "");
    const telegramUsername = usernameRaw === "-" ? null : usernameRaw;

    await ctx.reply("Введите полное имя сотрудника:");
    const nameMsg = await waitFor(conversation, ctx, "message:text");
    const fullName = nameMsg.message.text.trim();

    await ctx.reply("Введите отдел (department), либо '-':");
    const deptMsg = await waitFor(conversation, ctx, "message:text");
    const department = normalizeOptional(deptMsg.message.text);

    await ctx.reply("Введите должность (position), либо '-':");
    const posMsg = await waitFor(conversation, ctx, "message:text");
    const position = normalizeOptional(posMsg.message.text);

    await ctx.reply("Введите GitHub username сотрудника (для сопоставления коммитов), либо '-':");
    const ghMsg = await waitFor(conversation, ctx, "message:text");
    const githubUsername = normalizeOptional(ghMsg.message.text);

    try {
      const employee = await conversation.external(() =>
        prisma.employee.create({
          data: { companyId, telegramUsername, fullName, department, position, githubUsername },
        })
      );

      await ctx.reply(
        `Сотрудник "${employee.fullName}" добавлен (id: ${employee.id}).\n` +
          `Привяжите его к направлению через /linkdirection.`
      );
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        await ctx.reply(`Сотрудник с username "@${telegramUsername}" уже есть в этой компании. Отменено.`);
        return;
      }
      throw err;
    }
  });
}

function normalizeOptional(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "-" || trimmed === "" ? null : trimmed;
}

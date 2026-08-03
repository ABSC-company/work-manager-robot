import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";

export async function addEmployeeConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;

  await ctx.reply("Введите @username сотрудника в Telegram (без @), либо '-' если отсутствует:");
  const usernameMsg = await conversation.waitFor("message:text");
  const usernameRaw = usernameMsg.message.text.trim().replace(/^@/, "");
  const telegramUsername = usernameRaw === "-" ? null : usernameRaw;

  await ctx.reply("Введите полное имя сотрудника:");
  const nameMsg = await conversation.waitFor("message:text");
  const fullName = nameMsg.message.text.trim();

  await ctx.reply("Введите отдел (department), либо '-':");
  const deptMsg = await conversation.waitFor("message:text");
  const department = normalizeOptional(deptMsg.message.text);

  await ctx.reply("Введите должность (position), либо '-':");
  const posMsg = await conversation.waitFor("message:text");
  const position = normalizeOptional(posMsg.message.text);

  await ctx.reply("Введите GitHub username сотрудника (для сопоставления коммитов), либо '-':");
  const ghMsg = await conversation.waitFor("message:text");
  const githubUsername = normalizeOptional(ghMsg.message.text);

  const employee = await conversation.external(() =>
    prisma.employee.create({
      data: { companyId, telegramUsername, fullName, department, position, githubUsername },
    })
  );

  await ctx.reply(
    `Сотрудник "${employee.fullName}" добавлен (id: ${employee.id}).\n` +
      `Привяжите его к направлению через /linkdirection.`
  );
}

function normalizeOptional(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "-" || trimmed === "" ? null : trimmed;
}

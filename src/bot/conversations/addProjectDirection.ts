import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";

export async function addProjectConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

  await ctx.reply("Введите название проекта:");
  const nameMsg = await conversation.waitFor("message:text");
  const name = nameMsg.message.text.trim();

  const project = await conversation.external(() => prisma.project.create({ data: { companyId, name } }));

  await ctx.reply(`Проект "${project.name}" создан (id: ${project.id}). Добавьте направления через /adddirection.`);
}

export async function addDirectionConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

  const projects = await conversation.external(() => prisma.project.findMany({ where: { companyId } }));
  if (projects.length === 0) {
    await ctx.reply("В компании нет проектов. Сначала создайте проект командой /addproject.");
    return;
  }

  await ctx.reply(
    "Выберите проект, указав его id:\n" + projects.map((p) => `${p.id} — ${p.name}`).join("\n")
  );
  const projectMsg = await conversation.waitFor("message:text");
  const projectId = projectMsg.message.text.trim();
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    await ctx.reply("Проект с таким id не найден. Отменено.");
    return;
  }

  await ctx.reply("Введите название направления (например backend, frontend, mobile, design, qa, devops):");
  const nameMsg = await conversation.waitFor("message:text");
  const name = nameMsg.message.text.trim();

  const direction = await conversation.external(() =>
    prisma.direction.create({ data: { projectId: project.id, name } })
  );

  await ctx.reply(
    `Направление "${direction.name}" создано в проекте "${project.name}" (id: ${direction.id}).\n` +
      `Настройте его через /linkdirection.`
  );
}

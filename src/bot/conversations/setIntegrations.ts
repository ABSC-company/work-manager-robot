import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import { encryptSecret } from "../../utils/crypto";

export async function setJiraConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;

  await ctx.reply("Введите базовый URL Jira (например https://yourorg.atlassian.net):");
  const urlMsg = await conversation.waitFor("message:text");
  const jiraBaseUrl = urlMsg.message.text.trim();

  await ctx.reply("Введите email аккаунта Jira, привязанного к API-токену:");
  const emailMsg = await conversation.waitFor("message:text");
  const jiraEmail = emailMsg.message.text.trim();

  await ctx.reply("Введите Jira API-токен (сообщение будет удалено из чата после сохранения):");
  const tokenMsg = await conversation.waitFor("message:text");
  const rawToken = tokenMsg.message.text.trim();

  await conversation.external(() =>
    prisma.company.update({
      where: { id: companyId },
      data: { jiraBaseUrl, jiraEmail, jiraApiToken: encryptSecret(rawToken) },
    })
  );

  await tryDeleteMessage(ctx, tokenMsg.message.message_id);
  await ctx.reply("Jira организация привязана к компании.");
}

export async function setGithubConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;

  await ctx.reply("Введите название GitHub организации (например my-org):");
  const orgMsg = await conversation.waitFor("message:text");
  const githubOrg = orgMsg.message.text.trim();

  await ctx.reply("Введите GitHub Personal Access Token (repo, read:org). Сообщение будет удалено после сохранения:");
  const tokenMsg = await conversation.waitFor("message:text");
  const rawToken = tokenMsg.message.text.trim();

  await conversation.external(() =>
    prisma.company.update({
      where: { id: companyId },
      data: { githubOrg, githubToken: encryptSecret(rawToken) },
    })
  );

  await tryDeleteMessage(ctx, tokenMsg.message.message_id);
  await ctx.reply("GitHub организация привязана к компании.");
}

async function tryDeleteMessage(ctx: MyContext, messageId: number): Promise<void> {
  try {
    await ctx.api.deleteMessage(ctx.chat!.id, messageId);
  } catch {
    // bot may lack delete rights in this chat; token remains in chat history, not a hard failure
  }
}

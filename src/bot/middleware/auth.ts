import type { NextFunction } from "grammy";
import { config } from "../../config";
import { prisma } from "../../db/prisma";
import type { BotContext } from "../instance";

export function isSuperAdmin(telegramId: string): boolean {
  return config.telegram.superAdminIds.includes(telegramId);
}

export async function requireSuperAdmin(ctx: BotContext, next: NextFunction): Promise<void> {
  const id = String(ctx.from?.id ?? "");
  if (!isSuperAdmin(id)) {
    await ctx.reply("Эта команда доступна только супер-администраторам сервиса.");
    return;
  }
  await next();
}

/** Ensures the sender is an admin of at least one company, and resolves which company they're acting on. */
export async function requireCompanyAdmin(ctx: BotContext, next: NextFunction): Promise<void> {
  const id = String(ctx.from?.id ?? "");
  const memberships = await prisma.companyAdmin.findMany({ where: { telegramId: id }, include: { company: true } });

  if (memberships.length === 0) {
    await ctx.reply("Вы не являетесь администратором ни одной компании.");
    return;
  }

  if (memberships.length === 1) {
    ctx.session.activeCompanyId = memberships[0].companyId;
  } else if (!ctx.session.activeCompanyId || !memberships.some((m) => m.companyId === ctx.session.activeCompanyId)) {
    const list = memberships.map((m) => `${m.company.name} — /selectcompany ${m.company.id}`).join("\n");
    await ctx.reply(`Вы администратор нескольких компаний. Выберите активную командой:\n${list}`);
    return;
  }

  await next();
}

import { prisma } from "../db/prisma";
import { bot } from "../bot/instance";
import { logger } from "../utils/logger";
import type { Occasion } from "@prisma/client";

/** Sends an occasion reminder to all company admins and the linked group chat (if configured). */
export async function sendOccasionReminder(occasion: Occasion): Promise<void> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: occasion.companyId },
    include: { admins: true },
  });

  const text = `🔔 Напоминание: ${occasion.title}${occasion.description ? `\n${occasion.description}` : ""}`;

  const targets: string[] = company.admins.map((a) => a.telegramId);
  if (company.groupChatId) targets.push(company.groupChatId);

  for (const chatId of targets) {
    try {
      await bot.api.sendMessage(chatId, text);
    } catch (err) {
      logger.error({ err, chatId, occasionId: occasion.id }, "failed to send occasion reminder");
    }
  }
}

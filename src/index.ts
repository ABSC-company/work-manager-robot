import fs from "node:fs";
import { config } from "./config";
import { logger } from "./utils/logger";
import { prisma } from "./db/prisma";
import { bot } from "./bot/index";
import { startScheduler } from "./scheduler";

async function main(): Promise<void> {
  fs.mkdirSync(config.storage.uploadsDir, { recursive: true });
  fs.mkdirSync(config.storage.reportsDir, { recursive: true });

  await prisma.$connect();
  logger.info("database connected");

  const worker = await startScheduler();

  await bot.init();
  logger.info({ botUsername: bot.botInfo.username }, "starting telegram bot");
  bot.start({
    onStart: () => logger.info("bot polling started"),
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await bot.stop();
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});

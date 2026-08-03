import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "warn" },
    { emit: "event", level: "error" },
  ],
});

prisma.$on("warn" as never, (e: unknown) => logger.warn(e, "prisma warning"));
prisma.$on("error" as never, (e: unknown) => logger.error(e, "prisma error"));

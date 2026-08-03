import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";
import { logger } from "../utils/logger";
import { checkReportSchedules } from "./reportScheduler";
import { checkOccasions } from "./occasionScheduler";

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

const TICK_QUEUE_NAME = "scheduler-tick";

export const tickQueue = new Queue(TICK_QUEUE_NAME, { connection });

export async function startScheduler(): Promise<Worker> {
  await tickQueue.add(
    "tick",
    {},
    {
      repeat: { every: 60_000 },
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  const worker = new Worker(
    TICK_QUEUE_NAME,
    async () => {
      const now = new Date();
      await checkReportSchedules(now);
      await checkOccasions(now);
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "scheduler tick failed");
  });

  logger.info("scheduler started (1-minute tick)");
  return worker;
}

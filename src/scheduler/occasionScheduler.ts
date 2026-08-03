import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { getZonedParts, isDaysBeforeMonthEnd } from "../utils/time";
import { sendOccasionReminder } from "../events/dispatch";

export async function checkOccasions(now: Date): Promise<void> {
  const occasions = await prisma.occasion.findMany({ where: { active: true }, include: { company: true } });

  for (const occasion of occasions) {
    const tz = occasion.company.timezone;
    const parts = getZonedParts(now, tz);

    if (parts.hour !== occasion.hour || parts.minute !== occasion.minute) continue;
    if (alreadyFiredThisMinute(occasion.lastFiredAt, now)) continue;

    let due = false;

    if (occasion.type === "ONE_TIME") {
      if (occasion.scheduledAt) {
        const scheduledParts = getZonedParts(occasion.scheduledAt, tz);
        due = scheduledParts.year === parts.year && scheduledParts.month === parts.month && scheduledParts.day === parts.day;
      }
    } else {
      switch (occasion.frequency) {
        case "DAILY":
          due = true;
          break;
        case "WEEKLY":
          due = occasion.daysOfWeek.includes(parts.weekday);
          break;
        case "MONTHLY_DAY":
          due = parts.day === occasion.dayOfMonth;
          break;
        case "MONTHLY_BEFORE_END":
          due = isDaysBeforeMonthEnd(now, tz, occasion.daysBeforeMonthEnd ?? 3);
          break;
      }
    }

    if (!due) continue;

    try {
      await sendOccasionReminder(occasion);
      await prisma.occasion.update({
        where: { id: occasion.id },
        data: {
          lastFiredAt: now,
          active: occasion.type === "ONE_TIME" ? false : true,
        },
      });
    } catch (err) {
      logger.error({ err, occasionId: occasion.id }, "failed to fire occasion reminder");
    }
  }
}

function alreadyFiredThisMinute(lastFiredAt: Date | null, now: Date): boolean {
  if (!lastFiredAt) return false;
  return Math.abs(now.getTime() - lastFiredAt.getTime()) < 60_000;
}

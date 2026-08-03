import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { getZonedParts, isDaysBeforeMonthEnd, startOfDayInZone } from "../utils/time";
import { generateCompanyReport } from "../reports/service";
import { sendReportForApproval } from "../reports/dispatch";

/** Checks every enabled ReportSchedule against the current time (in the company's timezone) and fires due reports. */
export async function checkReportSchedules(now: Date): Promise<void> {
  const schedules = await prisma.reportSchedule.findMany({ where: { enabled: true }, include: { company: true } });

  for (const schedule of schedules) {
    const tz = schedule.company.timezone;
    const parts = getZonedParts(now, tz);

    if (parts.hour !== schedule.hour || parts.minute !== schedule.minute) continue;

    if (schedule.period === "WEEKLY" && parts.weekday !== (schedule.dayOfWeek ?? 5)) continue;
    if (schedule.period === "MONTHLY" && !isDaysBeforeMonthEnd(now, tz, schedule.daysBeforeMonthEnd ?? 3)) continue;

    // Dedupe against THIS schedule's own last run, not against the Report table — a manual /report
    // run for the same period earlier that day must not suppress the automatic send.
    const dayStart = startOfDayInZone(now, tz);
    if (schedule.lastRunAt && schedule.lastRunAt >= dayStart) continue;

    try {
      const reportId = await generateCompanyReport(schedule.companyId, schedule.period, now);
      await sendReportForApproval(reportId);
      await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: now } });
    } catch (err) {
      logger.error({ err, companyId: schedule.companyId, period: schedule.period }, "scheduled report failed");
    }
  }
}

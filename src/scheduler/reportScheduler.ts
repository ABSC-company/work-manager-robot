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

    const dayStart = startOfDayInZone(now, tz);
    const alreadyGenerated = await prisma.report.findFirst({
      where: {
        companyId: schedule.companyId,
        period: schedule.period,
        projectId: null,
        createdAt: { gte: dayStart },
      },
    });
    if (alreadyGenerated) continue;

    try {
      const reportId = await generateCompanyReport(schedule.companyId, schedule.period, now);
      await sendReportForApproval(reportId);
    } catch (err) {
      logger.error({ err, companyId: schedule.companyId, period: schedule.period }, "scheduled report failed");
    }
  }
}

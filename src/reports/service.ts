import path from "node:path";
import type { ReportPeriod } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { logger } from "../utils/logger";
import { startOfDayInZone, daysBeforeInstant } from "../utils/time";
import { buildCompanyReportData } from "./generator";
import { renderReportPdf } from "./pdf";

export function computePeriodBounds(
  period: Exclude<ReportPeriod, "CUSTOM">,
  timezone: string,
  now = new Date()
): { start: Date; end: Date } {
  const end = now;
  let start: Date;
  if (period === "DAILY") start = startOfDayInZone(now, timezone);
  else if (period === "WEEKLY") start = daysBeforeInstant(now, 7);
  else start = daysBeforeInstant(now, 30);
  return { start, end };
}

/** Generates a report (all projects of the company), persists the Report row + PDF, and marks it PENDING_APPROVAL.
 * For period "CUSTOM", `customBounds` is required and overrides the computed period window. */
export async function generateCompanyReport(
  companyId: string,
  period: ReportPeriod,
  now = new Date(),
  customBounds?: { start: Date; end: Date }
): Promise<string> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const { start, end } =
    customBounds ?? computePeriodBounds(period as Exclude<ReportPeriod, "CUSTOM">, company.timezone, now);

  const report = await prisma.report.create({
    data: {
      companyId,
      projectId: null,
      period,
      periodStart: start,
      periodEnd: end,
      status: "GENERATING",
    },
  });

  try {
    const data = await buildCompanyReportData({ companyId, period, periodStart: start, periodEnd: end });
    const fileName = `${companyId}_${period}_${report.id}.pdf`;
    const filePath = path.join(config.storage.reportsDir, fileName);
    await renderReportPdf(data, filePath);

    await prisma.report.update({
      where: { id: report.id },
      data: { status: "PENDING_APPROVAL", filePath },
    });

    logger.info({ reportId: report.id, companyId, period }, "report generated");
    return report.id;
  } catch (err) {
    logger.error({ err, reportId: report.id }, "report generation failed");
    await prisma.report.update({ where: { id: report.id }, data: { status: "FAILED", error: String(err) } });
    throw err;
  }
}

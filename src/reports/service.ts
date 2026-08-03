import path from "node:path";
import type { ReportPeriod } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { logger } from "../utils/logger";
import { startOfDayInZone, startOfWeekInZone, startOfMonthInZone } from "../utils/time";
import { buildCompanyReportData } from "./generator";
import { renderReportPdf } from "./pdf";

export function computePeriodBounds(period: ReportPeriod, timezone: string, now = new Date()) {
  const end = now;
  let start: Date;
  if (period === "DAILY") start = startOfDayInZone(now, timezone);
  else if (period === "WEEKLY") start = startOfWeekInZone(now, timezone);
  else start = startOfMonthInZone(now, timezone);
  return { start, end };
}

/** Generates a report (all projects of the company), persists the Report row + PDF, and marks it PENDING_APPROVAL. */
export async function generateCompanyReport(companyId: string, period: ReportPeriod, now = new Date()): Promise<string> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const { start, end } = computePeriodBounds(period, company.timezone, now);

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

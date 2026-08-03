import { InlineKeyboard, InputFile } from "grammy";
import { prisma } from "../db/prisma";
import { bot } from "../bot/instance";
import { logger } from "../utils/logger";

/** Sends a generated report PDF to all company admins with an inline "approve" button. */
export async function sendReportForApproval(reportId: string): Promise<void> {
  const report = await prisma.report.findUniqueOrThrow({
    where: { id: reportId },
    include: { company: { include: { admins: true } } },
  });

  if (!report.filePath) {
    logger.error({ reportId }, "cannot dispatch report without filePath");
    return;
  }

  const keyboard = new InlineKeyboard().text(
    `✅ Одобрить (0/${report.company.requiredApprovals})`,
    `report_approve:${report.id}`
  );

  const caption = `Отчёт компании "${report.company.name}" (${report.period}) за период ${report.periodStart
    .toISOString()
    .slice(0, 10)}..${report.periodEnd.toISOString().slice(0, 10)}.\nТребуется одобрений: ${report.company.requiredApprovals}.`;

  for (const admin of report.company.admins) {
    try {
      await bot.api.sendDocument(admin.telegramId, new InputFile(report.filePath), {
        caption,
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error({ err, adminId: admin.telegramId, reportId }, "failed to send report to admin");
    }
  }
}

/** Records an admin's approval; once the required threshold is reached, forwards the report to the linked group chat. */
export async function registerApproval(reportId: string, telegramId: string): Promise<{ approvedCount: number; required: number; justApproved: boolean }> {
  const report = await prisma.report.findUniqueOrThrow({
    where: { id: reportId },
    include: { company: { include: { admins: true } }, approvals: true },
  });

  const companyAdmin = report.company.admins.find((a) => a.telegramId === telegramId);
  if (!companyAdmin) {
    throw new Error("Only company admins can approve this report");
  }

  await prisma.reportApproval.upsert({
    where: { reportId_companyAdminId: { reportId, companyAdminId: companyAdmin.id } },
    create: { reportId, companyAdminId: companyAdmin.id },
    update: {},
  });

  const approvedCount = await prisma.reportApproval.count({ where: { reportId } });
  const required = report.company.requiredApprovals;
  let justApproved = false;

  if (approvedCount >= required && report.status !== "APPROVED" && report.status !== "SENT") {
    await prisma.report.update({ where: { id: reportId }, data: { status: "APPROVED" } });
    justApproved = true;
    if (report.company.groupChatId && report.filePath) {
      await bot.api.sendDocument(report.company.groupChatId, new InputFile(report.filePath), {
        caption: `Отчёт компании "${report.company.name}" (${report.period}), одобрен администраторами.`,
      });
      await prisma.report.update({ where: { id: reportId }, data: { status: "SENT" } });
    }
  }

  return { approvedCount, required, justApproved };
}

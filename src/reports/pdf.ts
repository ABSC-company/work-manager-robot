import PDFDocument from "pdfkit";
import fs from "node:fs";
import type { CompanyReportData, EmployeeReportBlock } from "./types";
import type { AggregateMetrics } from "./metrics";
import { drawStatusBarChart, drawCompletionDonut } from "./charts";

const PAGE_MARGIN = 40;

export async function renderReportPdf(data: CompanyReportData, outputPath: string): Promise<void> {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4", bufferPages: true });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  doc.fontSize(20).text(`Отчёт: ${data.companyName}`, { align: "left" });
  doc.fontSize(12).fillColor("#555").text(periodTitle(data.period) + ` — ${data.periodLabel}`);
  doc.fillColor("#000").moveDown(1);

  renderMetricsSection(doc, "Общие показатели по компании", data.overallMetrics);
  doc.moveDown(1);

  for (const project of data.projects) {
    doc.addPage();
    doc.fontSize(16).text(`Проект: ${project.projectName}`);
    doc.moveDown(0.5);
    renderMetricsSection(doc, `Показатели проекта "${project.projectName}"`, project.metrics);

    for (const direction of project.directions) {
      doc.moveDown(1);
      doc.fontSize(14).fillColor("#000").text(`Направление: ${direction.directionName}`);
      renderMetricsTable(doc, direction.metrics);

      for (const employee of direction.employees) {
        renderEmployeeBlock(doc, employee);
      }
    }
  }

  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

function periodTitle(period: CompanyReportData["period"]): string {
  if (period === "DAILY") return "Ежедневный отчёт";
  if (period === "WEEKLY") return "Еженедельный отчёт";
  return "Ежемесячный отчёт";
}

function renderMetricsSection(doc: PDFKit.PDFDocument, title: string, metrics: AggregateMetrics): void {
  renderMetricsTable(doc, metrics);

  if (Object.keys(metrics.statusCounts).length > 0) {
    const y = doc.y;
    const barChartWidth = 260;
    const donutRadius = 55;
    drawStatusBarChart(doc, metrics, { x: PAGE_MARGIN, y, width: barChartWidth, height: 130, title: `Задачи по статусам — ${title}` });
    drawCompletionDonut(doc, metrics, {
      x: PAGE_MARGIN + barChartWidth + 60 + donutRadius,
      y: y + 30 + donutRadius,
      radius: donutRadius,
      title: `% выполнения — ${title}`,
    });
    doc.y = y + 150;
  }
}

function renderMetricsTable(doc: PDFKit.PDFDocument, metrics: AggregateMetrics): void {
  doc.fontSize(10).fillColor("#333");
  doc.text(`Всего задач: ${metrics.totalTasks}   Завершено: ${metrics.completedTasks}   % выполнения: ${metrics.completionPercent.toFixed(1)}%`);
  doc.text(
    `Среднее время выполнения задачи: ${formatHours(metrics.avgTaskDurationHours)}   Средний интервал между задачами: ${formatHours(
      metrics.avgGapBetweenTasksHours
    )}`
  );
  const statusLine = Object.entries(metrics.statusCounts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  if (statusLine) doc.text(`По статусам: ${statusLine}`);
  doc.fillColor("#000").moveDown(0.5);
}

function renderEmployeeBlock(doc: PDFKit.PDFDocument, employee: EmployeeReportBlock): void {
  if (doc.y > 650) doc.addPage();

  doc.moveDown(0.5);
  doc
    .fontSize(12)
    .fillColor("#111")
    .text(`${employee.employeeName}${employee.position ? ` — ${employee.position}` : ""}${employee.department ? ` (${employee.department})` : ""}`);

  renderMetricsTable(doc, {
    totalTasks: employee.metrics.totalTasks,
    completedTasks: employee.metrics.completedTasks,
    completionPercent: employee.metrics.completionPercent,
    statusCounts: employee.metrics.statusCounts,
    avgTaskDurationHours: employee.metrics.avgTaskDurationHours,
    avgGapBetweenTasksHours: employee.metrics.avgGapBetweenTasksHours,
  });

  if (employee.metrics.totalTasks === 0) {
    doc.fontSize(9).fillColor("#888").text("Задач в backlog нет — сотрудник свободен.");
  } else if (!employee.metrics.hasBacklog) {
    doc.fontSize(9).fillColor("#888").text("Дополнительных задач в backlog нет.");
  } else {
    doc.fontSize(9).fillColor("#888").text(`В backlog ещё ${employee.metrics.backlogCount} задач(и), ожидающих взятия в работу.`);
  }
  doc.fillColor("#000");

  doc.fontSize(9).fillColor("#333").text(employee.aiSummary, { align: "justify" });
  doc.fillColor("#000").moveDown(0.3);

  for (const issue of employee.issues) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(9).fillColor("#000").text(`• ${issue.key}: ${issue.summary} [${issue.currentStatus}]`);
    const history = issue.statusHistory.map((t) => `${t.from ?? "—"}→${t.to} (${t.at.toISOString().slice(0, 16)})`).join("; ");
    if (history) doc.fontSize(8).fillColor("#666").text(`  История: ${history}`);
    if (issue.workDoneNote) {
      const docLabel =
        issue.followsDocumentation === true ? " [соответствует документации]" : issue.followsDocumentation === false ? " [расхождение с документацией]" : "";
      doc.fontSize(8).fillColor("#666").text(`  GitHub: ${issue.workDoneNote}${docLabel}`);
    }
  }
  doc.fillColor("#000").moveDown(0.5);
}

function formatHours(hours: number | null): string {
  if (hours === null) return "н/д";
  if (hours < 24) return `${hours.toFixed(1)} ч`;
  return `${(hours / 24).toFixed(1)} дн`;
}

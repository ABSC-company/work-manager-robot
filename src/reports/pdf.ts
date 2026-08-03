import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import type { CompanyReportData, EmployeeReportBlock, DirectionReportBlock } from "./types";
import type { AggregateMetrics } from "./metrics";
import { drawStatusBarChart, drawCompletionDonut, drawEmployeeComparisonChart } from "./charts";

const PAGE_MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89; // A4
const USABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// DejaVu Sans ships full Cyrillic + Latin glyph coverage in one file, unlike PDFKit's built-in
// Helvetica/Times (Latin-only AFM fonts, which render Russian text as garbage/missing glyphs).
const FONT_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
const FONT_REGULAR = "Body";
const FONT_BOLD = "Body-Bold";

export async function renderReportPdf(data: CompanyReportData, outputPath: string): Promise<void> {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4", bufferPages: true });
  doc.registerFont(FONT_REGULAR, path.join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont(FONT_BOLD, path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  doc.font(FONT_REGULAR);

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  doc.font(FONT_BOLD).fontSize(20).text(`Отчёт: ${data.companyName}`, PAGE_MARGIN, PAGE_MARGIN, { width: USABLE_WIDTH });
  doc.font(FONT_REGULAR).fontSize(12).fillColor("#555").text(periodTitle(data.period) + ` — ${data.periodLabel}`, {
    width: USABLE_WIDTH,
  });
  doc.fillColor("#000").moveDown(1);
  resetX(doc);

  renderMetricsSection(doc, "Общие показатели по компании", data.overallMetrics);

  for (const project of data.projects) {
    doc.addPage();
    resetX(doc);
    doc.font(FONT_BOLD).fontSize(16).text(`Проект: ${project.projectName}`, { width: USABLE_WIDTH });
    doc.font(FONT_REGULAR);
    doc.moveDown(0.5);
    resetX(doc);
    renderMetricsSection(doc, `Показатели проекта "${project.projectName}"`, project.metrics);

    for (const direction of project.directions) {
      renderDirectionBlock(doc, direction);
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

/** Resets the text cursor to the left margin. Needed after chart helpers draw at explicit x coordinates,
 * otherwise pdfkit keeps flowing subsequent auto-positioned text from wherever the last chart label ended,
 * which is how text used to run off the right edge of the page. */
function resetX(doc: PDFKit.PDFDocument): void {
  doc.x = PAGE_MARGIN;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) {
    doc.addPage();
    resetX(doc);
  }
}

function renderMetricsSection(doc: PDFKit.PDFDocument, title: string, metrics: AggregateMetrics): void {
  renderMetricsTable(doc, metrics);

  if (Object.keys(metrics.statusCounts).length > 0) {
    ensureSpace(doc, 170);
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
    resetX(doc);
  }
  doc.moveDown(0.5);
}

function renderMetricsTable(doc: PDFKit.PDFDocument, metrics: AggregateMetrics): void {
  doc.fontSize(10).fillColor("#333");
  doc.text(`Всего задач: ${metrics.totalTasks}   Завершено: ${metrics.completedTasks}   % выполнения: ${metrics.completionPercent.toFixed(1)}%`, {
    width: USABLE_WIDTH,
  });
  doc.text(
    `Среднее время выполнения задачи: ${formatHours(metrics.avgTaskDurationHours)}   Средний интервал между задачами: ${formatHours(
      metrics.avgGapBetweenTasksHours
    )}`,
    { width: USABLE_WIDTH }
  );
  const statusLine = Object.entries(metrics.statusCounts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  if (statusLine) doc.text(`По статусам: ${statusLine}`, { width: USABLE_WIDTH });
  doc.fillColor("#000").moveDown(0.5);
  resetX(doc);
}

function renderDirectionBlock(doc: PDFKit.PDFDocument, direction: DirectionReportBlock): void {
  ensureSpace(doc, 40);
  doc.moveDown(1);
  resetX(doc);
  doc.font(FONT_BOLD).fontSize(14).fillColor("#000").text(`Направление: ${direction.directionName}`, { width: USABLE_WIDTH });
  doc.font(FONT_REGULAR);
  renderMetricsSection(doc, `направления "${direction.directionName}"`, direction.metrics);

  if (direction.employees.length > 0) {
    ensureSpace(doc, 30 + direction.employees.length * 16);
    const y = drawEmployeeComparisonChart(
      doc,
      direction.employees.map((e) => ({
        employeeName: e.employeeName,
        totalTasks: e.metrics.totalTasks,
        completedTasks: e.metrics.completedTasks,
      })),
      { x: PAGE_MARGIN, y: doc.y, width: USABLE_WIDTH, title: "Сравнение сотрудников — задачи (закрыто/всего)" }
    );
    doc.y = y;
    resetX(doc);
    doc.moveDown(0.5);
  }

  for (const employee of direction.employees) {
    renderEmployeeBlock(doc, employee);
  }
}

function renderEmployeeBlock(doc: PDFKit.PDFDocument, employee: EmployeeReportBlock): void {
  ensureSpace(doc, 90);

  doc.moveDown(0.5);
  resetX(doc);
  doc
    .font(FONT_BOLD)
    .fontSize(12)
    .fillColor("#111")
    .text(`${employee.employeeName}${employee.position ? ` — ${employee.position}` : ""}${employee.department ? ` (${employee.department})` : ""}`, {
      width: USABLE_WIDTH,
    });
  doc.font(FONT_REGULAR);

  renderMetricsTable(doc, {
    totalTasks: employee.metrics.totalTasks,
    completedTasks: employee.metrics.completedTasks,
    completionPercent: employee.metrics.completionPercent,
    statusCounts: employee.metrics.statusCounts,
    avgTaskDurationHours: employee.metrics.avgTaskDurationHours,
    avgGapBetweenTasksHours: employee.metrics.avgGapBetweenTasksHours,
  });

  if (employee.metrics.totalTasks === 0) {
    doc.fontSize(9).fillColor("#888").text("Задач в backlog нет — сотрудник свободен.", { width: USABLE_WIDTH });
  } else if (!employee.metrics.hasBacklog) {
    doc.fontSize(9).fillColor("#888").text("Дополнительных задач в backlog нет.", { width: USABLE_WIDTH });
  } else {
    doc.fontSize(9).fillColor("#888").text(`В backlog ещё ${employee.metrics.backlogCount} задач(и), ожидающих взятия в работу.`, {
      width: USABLE_WIDTH,
    });
  }
  doc.fillColor("#000");

  doc.fontSize(9).fillColor("#333").text(employee.aiSummary, { width: USABLE_WIDTH, align: "justify" });
  doc.fillColor("#000").moveDown(0.3);
  resetX(doc);

  for (const issue of employee.issues) {
    ensureSpace(doc, 40);
    resetX(doc);
    doc.fontSize(9).fillColor("#000").text(`• ${issue.key}: ${issue.summary} [${issue.currentStatus}]`, { width: USABLE_WIDTH });
    const history = issue.statusHistory.map((t) => `${t.from ?? "—"}→${t.to} (${t.at.toISOString().slice(0, 16)})`).join("; ");
    if (history) doc.fontSize(8).fillColor("#666").text(`  История: ${history}`, { width: USABLE_WIDTH - 10 });
    if (issue.workDoneNote) {
      const docLabel =
        issue.followsDocumentation === true ? " [соответствует документации]" : issue.followsDocumentation === false ? " [расхождение с документацией]" : "";
      doc.fontSize(8).fillColor("#666").text(`  GitHub: ${issue.workDoneNote}${docLabel}`, { width: USABLE_WIDTH - 10 });
    }
  }
  doc.fillColor("#000").moveDown(0.5);
  resetX(doc);
}

function formatHours(hours: number | null): string {
  if (hours === null) return "н/д";
  if (hours < 24) return `${hours.toFixed(1)} ч`;
  return `${(hours / 24).toFixed(1)} дн`;
}

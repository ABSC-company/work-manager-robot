import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import type { CompanyReportData, EmployeeReportBlock, DirectionReportBlock, IdlePeriodEntry } from "./types";
import type { AggregateMetrics } from "./metrics";
import { drawStatusBarChart, drawCompletionDonut, drawTaskComparisonChart, drawDurationChart } from "./charts";
import { drawTable } from "./table";
import type { TableColumn } from "./table";

const PAGE_MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4
const USABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// Minimalist chart sizing: small enough to feel like inline stats, not full illustrations.
const BAR_CHART_WIDTH = 170;
const BAR_CHART_BODY_HEIGHT = 64; // bars only, title height is measured separately and added on top
const DONUT_RADIUS = 32;
const CHART_GAP_X = 34;
const CHART_BLOCK_GAP = 18;

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
  doc.fillColor("#000").moveDown(1.2);
  resetX(doc);

  renderMetricsSection(doc, "Общие показатели по компании", data.overallMetrics);

  for (const project of data.projects) {
    doc.addPage();
    resetX(doc);
    doc.font(FONT_BOLD).fontSize(16).text(`Проект: ${project.projectName}`, { width: USABLE_WIDTH });
    doc.font(FONT_REGULAR);
    doc.moveDown(0.8);
    resetX(doc);
    renderMetricsSection(doc, `Показатели проекта "${project.projectName}"`, project.metrics);

    if (project.directions.length > 1) {
      ensureSpace(doc, 30 + project.directions.length * 14);
      const y = drawTaskComparisonChart(
        doc,
        project.directions.map((d) => ({ label: d.directionName, total: d.metrics.totalTasks, completed: d.metrics.completedTasks })),
        { x: PAGE_MARGIN, y: doc.y, width: USABLE_WIDTH, title: "Сравнение направлений — задачи (закрыто/всего)" }
      );
      doc.y = y + 8;
      resetX(doc);
      doc.moveDown(0.4);
      resetX(doc);
    }

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
  if (period === "WEEKLY") return "Еженедельный отчёт (последние 7 дней)";
  if (period === "MONTHLY") return "Ежемесячный отчёт (последние 30 дней)";
  return "Отчёт за выбранный период";
}

/** Resets the text cursor to the left margin. Needed after chart helpers draw at explicit x coordinates,
 * otherwise pdfkit keeps flowing subsequent auto-positioned text from wherever the last chart label ended,
 * which is how text used to run off the right edge of the page. */
function resetX(doc: PDFKit.PDFDocument): void {
  doc.x = PAGE_MARGIN;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number): boolean {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) {
    doc.addPage();
    resetX(doc);
    return true;
  }
  return false;
}

/** Thin horizontal rule used to visually separate sections that would otherwise sit flush against each other. */
function divider(doc: PDFKit.PDFDocument): void {
  resetX(doc);
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + USABLE_WIDTH, doc.y).strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  doc.strokeColor("#000");
  doc.moveDown(0.6);
  resetX(doc);
}

function sectionLabel(doc: PDFKit.PDFDocument, text: string): void {
  resetX(doc);
  doc.font(FONT_BOLD).fontSize(8).fillColor("#888").text(text.toUpperCase(), { width: USABLE_WIDTH });
  doc.font(FONT_REGULAR).fillColor("#000").moveDown(0.2);
  resetX(doc);
}

function renderMetricsSection(doc: PDFKit.PDFDocument, title: string, metrics: AggregateMetrics): void {
  renderMetricsTable(doc, metrics);

  if (Object.keys(metrics.statusCounts).length > 0) {
    // Generous worst-case reservation for the page-break check — titles can wrap to multiple lines,
    // the actual heights below (from the draw functions' return values) are what really matters.
    ensureSpace(doc, 160);
    const y = doc.y;
    const barBottom = drawStatusBarChart(doc, metrics, {
      x: PAGE_MARGIN,
      y,
      width: BAR_CHART_WIDTH,
      barAreaHeight: BAR_CHART_BODY_HEIGHT,
      title: `Статусы — ${title}`,
    });
    const donutBottom = drawCompletionDonut(doc, metrics, {
      x: PAGE_MARGIN + BAR_CHART_WIDTH + CHART_GAP_X + DONUT_RADIUS,
      y,
      radius: DONUT_RADIUS,
      title: `% выполнения — ${title}`,
    });
    doc.y = Math.max(barBottom, donutBottom) + CHART_BLOCK_GAP;
    resetX(doc);
  } else {
    doc.moveDown(0.5);
    resetX(doc);
  }
}

function renderMetricsTable(doc: PDFKit.PDFDocument, metrics: AggregateMetrics): void {
  doc.fontSize(10).fillColor("#333");
  doc.text(`Всего задач: ${metrics.totalTasks}   Завершено: ${metrics.completedTasks}   % выполнения: ${metrics.completionPercent.toFixed(1)}%`, {
    width: USABLE_WIDTH,
  });
  doc.moveDown(0.2);
  resetX(doc);
  doc.text(
    `Среднее время выполнения задачи: ${formatHours(metrics.avgTaskDurationHours)}   Средний простой между задачами: ${formatHours(
      metrics.avgGapBetweenTasksHours
    )}`,
    { width: USABLE_WIDTH }
  );
  const statusLine = Object.entries(metrics.statusCounts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  if (statusLine) {
    doc.moveDown(0.2);
    resetX(doc);
    doc.fillColor("#555").text(`По статусам: ${statusLine}`, { width: USABLE_WIDTH });
  }
  doc.fillColor("#000").moveDown(0.5);
  resetX(doc);
}

function renderDirectionBlock(doc: PDFKit.PDFDocument, direction: DirectionReportBlock): void {
  ensureSpace(doc, 40);
  doc.moveDown(1.2);
  divider(doc);
  doc.font(FONT_BOLD).fontSize(14).fillColor("#000").text(`Направление: ${direction.directionName}`, { width: USABLE_WIDTH });
  doc.font(FONT_REGULAR);
  doc.moveDown(0.4);
  resetX(doc);
  renderMetricsSection(doc, `направления "${direction.directionName}"`, direction.metrics);

  if (direction.employees.length > 1) {
    ensureSpace(doc, 30 + direction.employees.length * 12 * 2);
    const halfWidth = (USABLE_WIDTH - 20) / 2;

    const y = doc.y;
    const yAfterTasks = drawTaskComparisonChart(
      doc,
      direction.employees.map((e) => ({ label: e.employeeName, total: e.metrics.totalTasks, completed: e.metrics.completedTasks })),
      { x: PAGE_MARGIN, y, width: halfWidth, title: "Задачи (закрыто/всего)" }
    );
    const yAfterDuration = drawDurationChart(
      doc,
      direction.employees.map((e) => ({ label: e.employeeName, avgHours: e.metrics.avgTaskDurationHours })),
      { x: PAGE_MARGIN + halfWidth + 20, y, width: halfWidth, title: "Среднее время задачи" }
    );

    doc.y = Math.max(yAfterTasks, yAfterDuration) + 8;
    resetX(doc);
    doc.moveDown(0.4);
    resetX(doc);
  }

  for (const employee of direction.employees) {
    renderEmployeeBlock(doc, employee);
  }
}

function renderEmployeeBlock(doc: PDFKit.PDFDocument, employee: EmployeeReportBlock): void {
  ensureSpace(doc, 100);

  doc.moveDown(0.6);
  divider(doc);
  doc
    .font(FONT_BOLD)
    .fontSize(12)
    .fillColor("#111")
    .text(`${employee.employeeName}${employee.position ? ` — ${employee.position}` : ""}${employee.department ? ` (${employee.department})` : ""}`, {
      width: USABLE_WIDTH,
    });
  doc.font(FONT_REGULAR);
  doc.moveDown(0.4);
  resetX(doc);

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
  doc.fillColor("#000").moveDown(0.5);
  resetX(doc);

  sectionLabel(doc, "Итог по периоду");
  doc.fontSize(9).fillColor("#333").text(employee.aiSummary, { width: USABLE_WIDTH, align: "justify" });
  doc.fillColor("#000").moveDown(0.5);
  resetX(doc);

  sectionLabel(doc, "Простои");
  doc.fontSize(9).fillColor("#333").text(formatIdleSummary(employee.idleSummary), { width: USABLE_WIDTH });
  doc.fillColor("#000").moveDown(0.4);
  resetX(doc);

  if (employee.idleSummary.periods.length > 0) {
    const idleColumns: TableColumn<IdlePeriodEntry>[] = [
      { header: "Дата", width: 70, cell: (p) => p.date.toISOString().slice(0, 10) },
      { header: "Часы", width: 45, cell: (p) => formatHours(p.hours) },
      { header: "Причина", width: 140, cell: (p) => idleReasonLabel(p.reason) },
      { header: "Примечание", width: USABLE_WIDTH - (70 + 45 + 140), cell: (p) => p.note ?? "—" },
    ];
    const y = drawTable(doc, idleColumns, employee.idleSummary.periods, {
      x: PAGE_MARGIN,
      y: doc.y,
      fontRegular: FONT_REGULAR,
      fontBold: FONT_BOLD,
      ensureSpace: (h) => ensureSpace(doc, h),
    });
    doc.y = y;
    resetX(doc);
    doc.moveDown(0.4);
    resetX(doc);
  }
  doc.moveDown(0.2);
  resetX(doc);

  sectionLabel(doc, "Оценка эффективности (ИИ)");
  const workedLine =
    employee.estimatedWorkedHours !== null
      ? `Оценочно отработано: ${formatHours(employee.estimatedWorkedHours)} из ${formatHours(employee.periodHours)} периода.`
      : `Длительность периода: ${formatHours(employee.periodHours)}.`;
  doc.fontSize(9).fillColor("#333").text(workedLine, { width: USABLE_WIDTH });
  doc.moveDown(0.2);
  resetX(doc);
  doc.fontSize(9).fillColor("#333").text(employee.efficiencyAssessment, { width: USABLE_WIDTH, align: "justify" });
  doc.fillColor("#000").moveDown(0.6);
  resetX(doc);

  if (employee.commits.length > 0) {
    sectionLabel(doc, `Активность в GitHub (${employee.commits.length} коммит${pluralSuffix(employee.commits.length)})`);
    const sorted = [...employee.commits].sort((a, b) => b.date.getTime() - a.date.getTime());
    const shown = sorted.slice(0, 8);
    for (const commit of shown) {
      ensureSpace(doc, 14);
      resetX(doc);
      const firstLine = commit.message.split("\n")[0];
      doc.fontSize(8).fillColor("#333").text(`• ${commit.date.toISOString().slice(0, 10)}  ${truncateText(firstLine, 90)}`, {
        width: USABLE_WIDTH,
      });
    }
    if (sorted.length > shown.length) {
      doc.fontSize(8).fillColor("#888").text(`  …и ещё ${sorted.length - shown.length} коммит(ов).`, { width: USABLE_WIDTH });
    }
    doc.fillColor("#000").moveDown(0.5);
    resetX(doc);
  }

  if (employee.reviewsGiven.length > 0 || employee.pullRequestsMerged.length > 0) {
    sectionLabel(doc, "Ревью и merge PR в GitHub");
    for (const review of employee.reviewsGiven) {
      ensureSpace(doc, 14);
      resetX(doc);
      doc.fontSize(8).fillColor("#333").text(`• ${reviewVerdict(review.state)} PR #${review.prNumber}: ${truncateText(review.prTitle, 70)}`, {
        width: USABLE_WIDTH,
      });
    }
    for (const pr of employee.pullRequestsMerged) {
      ensureSpace(doc, 14);
      resetX(doc);
      doc.fontSize(8).fillColor("#333").text(`• Смёржил PR #${pr.number}: ${truncateText(pr.title, 70)}`, { width: USABLE_WIDTH });
    }
    doc.fillColor("#000").moveDown(0.5);
    resetX(doc);
  }

  if (employee.issues.length > 0) {
    sectionLabel(doc, "Задачи");
    resetX(doc);

    const columns: TableColumn<EmployeeReportBlock["issues"][number]>[] = [
      {
        header: "Задача",
        width: 115,
        cell: (issue) => `${issue.key}: ${truncateText(issue.summary, 55)}\n[${issue.currentStatus}]`,
      },
      {
        header: "Переходы статусов",
        width: 120,
        cell: (issue) =>
          issue.statusHistory.length > 0
            ? issue.statusHistory
                .map((t) => `${t.from ?? "—"}→${t.to} (${t.at.toISOString().slice(0, 16).replace("T", " ")})`)
                .join("\n")
            : "—",
      },
      {
        header: "Время",
        width: 42,
        cell: (issue) => (issue.durationHours !== null ? formatHours(issue.durationHours) : "в работе"),
      },
      {
        header: "Коммиты",
        width: 78,
        cell: (issue) =>
          issue.commits.length > 0
            ? issue.commits.map((c) => truncateText(c.message.split("\n")[0], 40)).join("\n")
            : "—",
      },
      {
        header: "Выжимка",
        width: USABLE_WIDTH - (115 + 120 + 42 + 78),
        cell: (issue) => {
          const docLabel =
            issue.followsDocumentation === true
              ? " [соответствует документации]"
              : issue.followsDocumentation === false
                ? " [расхождение с документацией]"
                : "";
          return `${issue.workDoneNote ?? "—"}${docLabel}`;
        },
      },
    ];

    const y = drawTable(doc, columns, employee.issues, {
      x: PAGE_MARGIN,
      y: doc.y,
      fontRegular: FONT_REGULAR,
      fontBold: FONT_BOLD,
      ensureSpace: (h) => ensureSpace(doc, h),
    });
    doc.y = y;
    resetX(doc);
    doc.moveDown(0.5);
    resetX(doc);
  }

  doc.fillColor("#000");
}

function reviewVerdict(state: string): string {
  switch (state) {
    case "APPROVED":
      return "Одобрил";
    case "CHANGES_REQUESTED":
      return "Запросил правки в";
    case "COMMENTED":
      return "Прокомментировал";
    case "DISMISSED":
      return "Отклонённое ревью:";
    default:
      return "Ревью:";
  }
}

function formatIdleSummary(idle: EmployeeReportBlock["idleSummary"]): string {
  if (idle.totalDays === 0) return "За период простоев не зафиксировано.";
  const parts = [`Всего дней простоя: ${idle.totalDays} (~${formatHours(idle.totalHours)}).`];
  if (idle.noBacklogDays > 0) parts.push(`Из них без задач в беклоге: ${idle.noBacklogDays}.`);
  if (idle.noActivityDays > 0) parts.push(`Из них с задачами в беклоге, но без видимой активности: ${idle.noActivityDays}.`);
  return parts.join(" ");
}

function idleReasonLabel(reason: IdlePeriodEntry["reason"]): string {
  if (reason === "NO_BACKLOG_TASKS") return "Нет задач в беклоге";
  return "Задачи есть, активности не зафиксировано";
}

function formatHours(hours: number | null): string {
  if (hours === null) return "н/д";
  if (hours < 24) return `${hours.toFixed(1)} ч`;
  return `${(hours / 24).toFixed(1)} дн`;
}

function pluralSuffix(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "а";
  return "ов";
}

function truncateText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

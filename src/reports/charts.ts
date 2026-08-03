import type { AggregateMetrics } from "./metrics";

const PALETTE = ["#4C6EF5", "#12B886", "#F59F00", "#E64980", "#7048E8", "#15AABF", "#FA5252", "#82C91E"];

/** Draws a simple vector bar chart (status distribution) directly onto the PDF — no native canvas dependency. */
export function drawStatusBarChart(
  doc: PDFKit.PDFDocument,
  metrics: AggregateMetrics,
  opts: { x: number; y: number; width: number; height: number; title: string }
): void {
  const entries = Object.entries(metrics.statusCounts);
  const { x, y, width, height, title } = opts;

  doc.fontSize(9).fillColor("#333").text(title, x, y, { width });
  const chartTop = y + 14;
  const chartHeight = height - 14;
  const axisY = chartTop + chartHeight;

  if (entries.length === 0) {
    doc.fontSize(8).fillColor("#999").text("Нет данных", x, chartTop);
    return;
  }

  const maxValue = Math.max(...entries.map(([, v]) => v), 1);
  const barGap = 8;
  const barWidth = (width - barGap * (entries.length - 1)) / entries.length;

  entries.forEach(([status, count], i) => {
    const barHeight = (count / maxValue) * (chartHeight - 16);
    const barX = x + i * (barWidth + barGap);
    const barY = axisY - barHeight;
    doc.rect(barX, barY, barWidth, barHeight).fill(PALETTE[i % PALETTE.length]);
    doc.fontSize(7).fillColor("#000").text(String(count), barX, barY - 9, { width: barWidth, align: "center" });
    doc
      .fontSize(6)
      .fillColor("#555")
      .text(truncate(status, 10), barX, axisY + 2, { width: barWidth, align: "center" });
  });

  doc.moveTo(x, axisY).lineTo(x + width, axisY).strokeColor("#ccc").stroke();
  doc.fillColor("#000").strokeColor("#000");
}

/** Draws a simple vector donut chart (completed vs remaining) directly onto the PDF. */
export function drawCompletionDonut(
  doc: PDFKit.PDFDocument,
  metrics: AggregateMetrics,
  opts: { x: number; y: number; radius: number; title: string }
): void {
  const { x, y, radius, title } = opts;
  const completed = metrics.completedTasks;
  const remaining = Math.max(metrics.totalTasks - metrics.completedTasks, 0);
  const total = completed + remaining;

  doc.fontSize(9).fillColor("#333").text(title, x - radius, y - radius - 14, { width: radius * 2, align: "center" });

  const cx = x;
  const cy = y;

  if (total === 0) {
    doc.circle(cx, cy, radius).fillColor("#eee").fill();
    doc.fontSize(8).fillColor("#999").text("Нет данных", cx - radius, cy - 4, { width: radius * 2, align: "center" });
    doc.fillColor("#000");
    return;
  }

  const completedFraction = completed / total;
  drawPieSlice(doc, cx, cy, radius, 0, completedFraction * 360, "#12B886");
  drawPieSlice(doc, cx, cy, radius, completedFraction * 360, 360, "#E9ECEF");

  doc.circle(cx, cy, radius * 0.55).fillColor("#fff").fill();
  doc
    .fontSize(11)
    .fillColor("#000")
    .text(`${metrics.completionPercent.toFixed(0)}%`, cx - radius, cy - 6, { width: radius * 2, align: "center" });
  doc.fillColor("#000");
}

function drawPieSlice(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
  color: string
): void {
  if (toDeg <= fromDeg) return;
  const steps = Math.max(2, Math.ceil((toDeg - fromDeg) / 6));
  doc.moveTo(cx, cy);
  for (let i = 0; i <= steps; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const rad = (Math.PI / 180) * (deg - 90);
    doc.lineTo(cx + r * Math.cos(rad), cy + r * Math.sin(rad));
  }
  doc.closePath().fillColor(color).fill();
}

/** Draws a horizontal stacked-bar comparison of completed vs. open tasks per employee. Returns the y coordinate after the chart. */
export function drawEmployeeComparisonChart(
  doc: PDFKit.PDFDocument,
  employees: { employeeName: string; totalTasks: number; completedTasks: number }[],
  opts: { x: number; y: number; width: number; title: string }
): number {
  const { x, y, width, title } = opts;
  doc.fontSize(9).fillColor("#333").text(title, x, y, { width });
  let rowY = y + 16;

  if (employees.length === 0) {
    doc.fontSize(8).fillColor("#999").text("Нет данных", x, rowY);
    doc.fillColor("#000");
    return rowY + 16;
  }

  const labelWidth = 120;
  const countWidth = 50;
  const trackWidth = width - labelWidth - countWidth;
  const barHeight = 10;
  const rowGap = 6;
  const maxValue = Math.max(...employees.map((e) => e.totalTasks), 1);

  for (const emp of employees) {
    const trackX = x + labelWidth;
    doc.fontSize(7.5).fillColor("#333").text(truncate(emp.employeeName, 20), x, rowY + 1, { width: labelWidth - 6 });

    doc.rect(trackX, rowY, trackWidth, barHeight).fillColor("#E9ECEF").fill();
    const totalWidth = (emp.totalTasks / maxValue) * trackWidth;
    const completedWidth = (emp.completedTasks / maxValue) * trackWidth;
    if (totalWidth > 0) doc.rect(trackX, rowY, totalWidth, barHeight).fillColor("#FFD8A8").fill();
    if (completedWidth > 0) doc.rect(trackX, rowY, completedWidth, barHeight).fillColor("#12B886").fill();

    doc.fontSize(7).fillColor("#333").text(`${emp.completedTasks}/${emp.totalTasks}`, trackX + trackWidth + 4, rowY + 1, {
      width: countWidth - 4,
    });

    rowY += barHeight + rowGap;
  }

  doc.fillColor("#000");
  return rowY + 4;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

import type { AggregateMetrics } from "./metrics";

const PALETTE = ["#4C6EF5", "#12B886", "#F59F00", "#E64980", "#7048E8", "#15AABF", "#FA5252", "#82C91E"];

/** Draws a compact vector bar chart (status distribution) directly onto the PDF — no native canvas dependency.
 * Returns the y coordinate immediately after the chart (title height is measured, not assumed, since long
 * titles wrap to 2-3 lines on narrow columns and a fixed offset would let the bars overlap the wrapped text). */
export function drawStatusBarChart(
  doc: PDFKit.PDFDocument,
  metrics: AggregateMetrics,
  opts: { x: number; y: number; width: number; barAreaHeight: number; title: string }
): number {
  const entries = Object.entries(metrics.statusCounts);
  const { x, y, width, barAreaHeight, title } = opts;

  doc.fontSize(7.5).fillColor("#666");
  const titleH = doc.heightOfString(title, { width });
  doc.text(title, x, y, { width });
  const chartTop = y + titleH + 4;
  const axisY = chartTop + barAreaHeight;

  if (entries.length === 0) {
    doc.fontSize(7).fillColor("#999").text("Нет данных", x, chartTop);
    doc.fillColor("#000");
    return chartTop + 12;
  }

  const maxValue = Math.max(...entries.map(([, v]) => v), 1);
  const barGap = 5;
  const barWidth = (width - barGap * (entries.length - 1)) / entries.length;

  entries.forEach(([status, count], i) => {
    const barHeight = (count / maxValue) * (barAreaHeight - 10);
    const barX = x + i * (barWidth + barGap);
    const barY = axisY - barHeight;
    doc.rect(barX, barY, barWidth, barHeight).fill(PALETTE[i % PALETTE.length]);
    doc.fontSize(6).fillColor("#000").text(String(count), barX, barY - 7, { width: barWidth, align: "center" });
    doc
      .fontSize(5.5)
      .fillColor("#555")
      .text(truncate(status, 8), barX, axisY + 2, { width: barWidth, align: "center" });
  });

  doc.moveTo(x, axisY).lineTo(x + width, axisY).strokeColor("#ccc").stroke();
  doc.fillColor("#000").strokeColor("#000");
  return axisY + 11;
}

/** Draws a compact vector donut chart (completed vs remaining) directly onto the PDF.
 * `opts.y` is the TOP of the block (title first, then the circle below it) — returns the bottom y. */
export function drawCompletionDonut(
  doc: PDFKit.PDFDocument,
  metrics: AggregateMetrics,
  opts: { x: number; y: number; radius: number; title: string }
): number {
  const { x, y, radius, title } = opts;
  const completed = metrics.completedTasks;
  const remaining = Math.max(metrics.totalTasks - metrics.completedTasks, 0);
  const total = completed + remaining;

  const titleWidth = radius * 2 + 20;
  const titleX = x - radius - 10;
  doc.fontSize(7.5).fillColor("#666");
  const titleH = doc.heightOfString(title, { width: titleWidth, align: "center" });
  doc.text(title, titleX, y, { width: titleWidth, align: "center" });

  const cx = x;
  const cy = y + titleH + 6 + radius;

  if (total === 0) {
    doc.circle(cx, cy, radius).fillColor("#eee").fill();
    doc.fontSize(7).fillColor("#999").text("Нет данных", cx - radius, cy - 4, { width: radius * 2, align: "center" });
    doc.fillColor("#000");
    return cy + radius;
  }

  const completedFraction = completed / total;
  drawPieSlice(doc, cx, cy, radius, 0, completedFraction * 360, "#12B886");
  drawPieSlice(doc, cx, cy, radius, completedFraction * 360, 360, "#E9ECEF");

  doc.circle(cx, cy, radius * 0.55).fillColor("#fff").fill();
  doc
    .fontSize(9)
    .fillColor("#000")
    .text(`${metrics.completionPercent.toFixed(0)}%`, cx - radius, cy - 5, { width: radius * 2, align: "center" });
  doc.fillColor("#000");
  return cy + radius;
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

export interface ComparisonItem {
  label: string;
  total: number;
  completed: number;
}

/** Draws a horizontal stacked-bar comparison (completed vs. open) across arbitrary items — employees or directions.
 * Returns the y coordinate after the chart. */
export function drawTaskComparisonChart(
  doc: PDFKit.PDFDocument,
  items: ComparisonItem[],
  opts: { x: number; y: number; width: number; title: string }
): number {
  const { x, y, width, title } = opts;
  doc.fontSize(8).fillColor("#666");
  const titleH = doc.heightOfString(title, { width });
  doc.text(title, x, y, { width });
  let rowY = y + titleH + 4;

  if (items.length === 0) {
    doc.fontSize(7).fillColor("#999").text("Нет данных", x, rowY);
    doc.fillColor("#000");
    return rowY + 14;
  }

  const labelWidth = 110;
  const countWidth = 44;
  const trackWidth = width - labelWidth - countWidth;
  const barHeight = 8;
  const rowGap = 4;
  const maxValue = Math.max(...items.map((e) => e.total), 1);

  for (const item of items) {
    const trackX = x + labelWidth;
    doc.fontSize(7).fillColor("#333").text(truncate(item.label, 18), x, rowY, { width: labelWidth - 6 });

    doc.rect(trackX, rowY, trackWidth, barHeight).fillColor("#E9ECEF").fill();
    const totalWidth = (item.total / maxValue) * trackWidth;
    const completedWidth = (item.completed / maxValue) * trackWidth;
    if (totalWidth > 0) doc.rect(trackX, rowY, totalWidth, barHeight).fillColor("#FFD8A8").fill();
    if (completedWidth > 0) doc.rect(trackX, rowY, completedWidth, barHeight).fillColor("#12B886").fill();

    doc.fontSize(6.5).fillColor("#333").text(`${item.completed}/${item.total}`, trackX + trackWidth + 4, rowY, {
      width: countWidth - 4,
    });

    rowY += barHeight + rowGap;
  }

  doc.fillColor("#000");
  return rowY + 3;
}

export interface DurationItem {
  label: string;
  avgHours: number | null;
}

/** Draws a horizontal bar chart comparing average task completion time across employees. Returns the y after the chart. */
export function drawDurationChart(
  doc: PDFKit.PDFDocument,
  items: DurationItem[],
  opts: { x: number; y: number; width: number; title: string }
): number {
  const { x, y, width, title } = opts;
  doc.fontSize(8).fillColor("#666");
  const titleH = doc.heightOfString(title, { width });
  doc.text(title, x, y, { width });
  let rowY = y + titleH + 4;

  const withData = items.filter((i): i is { label: string; avgHours: number } => i.avgHours !== null);
  if (withData.length === 0) {
    doc.fontSize(7).fillColor("#999").text("Нет данных", x, rowY);
    doc.fillColor("#000");
    return rowY + 14;
  }

  const labelWidth = 110;
  const valueWidth = 50;
  const trackWidth = width - labelWidth - valueWidth;
  const barHeight = 8;
  const rowGap = 4;
  const maxValue = Math.max(...withData.map((e) => e.avgHours), 1);

  for (const item of items) {
    const trackX = x + labelWidth;
    doc.fontSize(7).fillColor("#333").text(truncate(item.label, 18), x, rowY, { width: labelWidth - 6 });
    doc.rect(trackX, rowY, trackWidth, barHeight).fillColor("#E9ECEF").fill();

    if (item.avgHours !== null) {
      const barWidth = (item.avgHours / maxValue) * trackWidth;
      if (barWidth > 0) doc.rect(trackX, rowY, barWidth, barHeight).fillColor("#4C6EF5").fill();
      const label = item.avgHours < 24 ? `${item.avgHours.toFixed(1)}ч` : `${(item.avgHours / 24).toFixed(1)}д`;
      doc.fontSize(6.5).fillColor("#333").text(label, trackX + trackWidth + 4, rowY, { width: valueWidth - 4 });
    } else {
      doc.fontSize(6.5).fillColor("#999").text("н/д", trackX + trackWidth + 4, rowY, { width: valueWidth - 4 });
    }

    rowY += barHeight + rowGap;
  }

  doc.fillColor("#000");
  return rowY + 3;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

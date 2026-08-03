export interface TableColumn<T> {
  header: string;
  width: number;
  cell: (row: T) => string;
}

const HEADER_HEIGHT = 14;
const CELL_PADDING_X = 4;
const CELL_PADDING_Y = 3;
const ROW_MIN_HEIGHT = 14;

/**
 * Draws a simple bordered table with wrapping cells and page-break support (redrawing the header row
 * on every new page). Returns the y coordinate after the table.
 */
export function drawTable<T>(
  doc: PDFKit.PDFDocument,
  columns: TableColumn<T>[],
  rows: T[],
  opts: {
    x: number;
    y: number;
    fontRegular: string;
    fontBold: string;
    fontSize?: number;
    ensureSpace: (height: number) => boolean; // returns true if it started a new page
  }
): number {
  const fontSize = opts.fontSize ?? 7.5;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  let y = opts.y;

  const drawHeader = () => {
    doc.rect(opts.x, y, totalWidth, HEADER_HEIGHT).fillColor("#F1F3F5").fill();
    doc.font(opts.fontBold).fontSize(fontSize).fillColor("#444");
    let colX = opts.x;
    for (const col of columns) {
      doc.text(col.header, colX + CELL_PADDING_X, y + CELL_PADDING_Y, { width: col.width - CELL_PADDING_X * 2 });
      colX += col.width;
    }
    doc.font(opts.fontRegular).fillColor("#000");
    y += HEADER_HEIGHT;
  };

  drawHeader();

  for (const row of rows) {
    doc.font(opts.fontRegular).fontSize(fontSize);
    const cellTexts = columns.map((c) => c.cell(row));
    const rowHeight = Math.max(
      ROW_MIN_HEIGHT,
      ...cellTexts.map((text, i) => doc.heightOfString(text, { width: columns[i].width - CELL_PADDING_X * 2 }) + CELL_PADDING_Y * 2)
    );

    const startedNewPage = opts.ensureSpace(rowHeight + HEADER_HEIGHT);
    if (startedNewPage) {
      y = doc.y;
      drawHeader();
    }

    let colX = opts.x;
    doc.fillColor("#000");
    cellTexts.forEach((text, i) => {
      doc.text(text, colX + CELL_PADDING_X, y + CELL_PADDING_Y, { width: columns[i].width - CELL_PADDING_X * 2 });
      colX += columns[i].width;
    });

    doc
      .moveTo(opts.x, y + rowHeight)
      .lineTo(opts.x + totalWidth, y + rowHeight)
      .strokeColor("#E9ECEF")
      .lineWidth(0.5)
      .stroke();
    doc.strokeColor("#000");

    y += rowHeight;
  }

  return y;
}

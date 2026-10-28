import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { Packet, Section } from "./types";

const PAGE = { width: 612, height: 792, margin: 56 };
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.38, 0.42, 0.48);
const ACCENT = rgb(0.12, 0.33, 0.62);

/** Standard PDF fonts only cover WinAnsi; swap characters they can't draw. */
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/•/g, "-")
    .replace(/≥/g, ">=")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safe(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private pdf: PDFDocument,
    private fonts: { regular: PDFFont; bold: PDFFont },
    private footer: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
    const n = this.pdf.getPageCount();
    this.page.drawText(safe(`${this.footer} - page ${n}`), { x: PAGE.margin, y: 28, size: 8, font: this.fonts.regular, color: MUTED });
  }

  ensure(height: number) {
    if (this.y - height < PAGE.margin) this.newPage();
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const indent = opts.indent ?? 0;
    for (const line of wrap(text, font, size, PAGE.width - PAGE.margin * 2 - indent)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: PAGE.margin + indent, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 6;
  }

  table(headers: string[], rows: string[][]) {
    const width = PAGE.width - PAGE.margin * 2;
    const col = width / headers.length;
    const drawRow = (cells: string[], bold: boolean) => {
      const font = bold ? this.fonts.bold : this.fonts.regular;
      const wrapped = cells.map((c) => wrap(c, font, 9, col - 6));
      const h = Math.max(...wrapped.map((w) => w.length)) * 12 + 6;
      this.ensure(h);
      wrapped.forEach((lines, i) =>
        lines.forEach((l, j) => this.page.drawText(l, { x: PAGE.margin + i * col + 3, y: this.y - 12 - j * 12, size: 9, font, color: INK })),
      );
      this.y -= h;
      this.page.drawLine({ start: { x: PAGE.margin, y: this.y + 2 }, end: { x: PAGE.margin + width, y: this.y + 2 }, thickness: 0.5, color: MUTED });
    };
    drawRow(headers, true);
    rows.forEach((r) => drawRow(r, false));
    this.y -= 8;
  }

  section(s: Section) {
    if (s.heading) this.text(s.heading, { size: 11, bold: true, gap: 2 });
    s.paragraphs?.forEach((p) => this.text(p));
    if (s.callout) this.text(s.callout, { bold: true, color: ACCENT });
    s.bullets?.forEach((b) => this.text(`- ${b}`, { indent: 10, gap: 2 }));
    if (s.bullets?.length) this.y -= 4;
    if (s.table) this.table(s.table.headers, s.table.rows);
  }
}

/** Render a packet as one PDF: each document starts on a new page (NOT-3). Cover page carries the enrollee QR code (NOT-7). */
export async function renderPacketPdf(packet: Packet, opts: { administratorName: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(packet.kind === "election" ? "COBRA election packet" : "COBRA notice");
  pdf.setAuthor(opts.administratorName);
  pdf.setCreationDate(new Date(`${packet.noticeDate}T12:00:00Z`));
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const qrPng = await QRCode.toBuffer(packet.enrolleeUrl, { margin: 1, width: 240 });
  const qr = await pdf.embedPng(qrPng);

  const w = new Writer(pdf, fonts, `${opts.administratorName} - ${packet.addressee.name}`);
  packet.documents.forEach((d, i) => {
    if (i > 0) w.newPage();
    if (i === 0) {
      w.page.drawImage(qr, { x: PAGE.width - PAGE.margin - 84, y: PAGE.height - PAGE.margin - 84, width: 84, height: 84 });
    }
    w.text(d.title, { size: 15, bold: true, gap: 2 });
    w.text(`${d.rule} - template ${d.templateVersion}`, { size: 8, color: MUTED, gap: 10 });
    d.sections.forEach((s) => w.section(s));
  });

  return pdf.save();
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

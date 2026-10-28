import { PDFDocument, StandardFonts } from "pdf-lib";

/** The test PDF people open to prove they can view the format before consenting (NOT-11). */
export async function GET() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("COBRA on Demand - test document", { x: 56, y: 720, size: 18, font });
  page.drawText("If you can read this, you can view your COBRA notices electronically.", { x: 56, y: 690, size: 11, font });
  page.drawText("Go back to the consent page to finish.", { x: 56, y: 672, size: 11, font });
  return new Response(Buffer.from(await pdf.save()), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="test.pdf"' } });
}

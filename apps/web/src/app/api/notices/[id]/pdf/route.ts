import { getMembership, getNoticeDocument } from "@cod/core";
import { getDb, tables } from "@cod/db";
import { eq } from "drizzle-orm";
import { getEnrolleeSession, getUserSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Notice PDFs: visible to the employer's users, ops, and the beneficiaries of that event. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [notice] = await db.select().from(tables.notices).where(eq(tables.notices.id, id));
  if (!notice) return new Response("Not found", { status: 404 });

  let allowed = false;
  const user = await getUserSession();
  if (user?.kind === "ops") allowed = true;
  else if (user) allowed = (await getMembership(user.userId))?.company.id === notice.companyId;
  if (!allowed) {
    const enrollee = await getEnrolleeSession();
    allowed = Boolean(enrollee && enrollee.companyId === notice.companyId && enrollee.eventId === notice.eventId);
  }
  if (!allowed) return new Response("Not found", { status: 404 });

  const doc = await getNoticeDocument(notice.companyId, id);
  if (!doc) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(doc.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="cobra-notice-${doc.notice.sentAt?.toISOString().slice(0, 10) ?? "draft"}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-SHA256": doc.document.sha256,
    },
  });
}

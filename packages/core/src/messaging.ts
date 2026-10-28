import { getDb, tables } from "@cod/db";

/**
 * Outbound email, SMS and print-and-mail (COM-1, COM-2, NOT-4). Every message
 * is stored against its related record. Real providers (Postmark/SendGrid,
 * Twilio, Lob) plug in behind these functions; until their keys are set the
 * dev provider records the message and marks it sent, and the ops console's
 * Outbox shows it.
 */

type Related = { companyId?: string | null; relatedType?: string; relatedId?: string };

async function record(channel: "email" | "sms" | "mail", to: string, subject: string | null, body: string, related: Related, providerRef: string) {
  const db = await getDb();
  const [row] = await db
    .insert(tables.messages)
    .values({
      companyId: related.companyId ?? null,
      channel,
      to,
      subject,
      body,
      relatedType: related.relatedType,
      relatedId: related.relatedId,
      status: "sent",
      providerRef,
    })
    .returning({ id: tables.messages.id });
  if (process.env.NODE_ENV !== "test" && process.env.LOG_MESSAGES !== "false") {
    console.info(`[${channel}] → ${to}${subject ? ` · ${subject}` : ""}`);
  }
  return row!.id;
}

export async function sendEmail(to: string, subject: string, body: string, related: Related = {}) {
  // Provider hook: POSTMARK_TOKEN / SENDGRID_API_KEY (BAA required before PHI is sent).
  return record("email", to, subject, body, related, `dev-email-${Date.now()}`);
}

export async function sendSms(to: string, body: string, related: Related = {}) {
  // Provider hook: TWILIO_* (BAA required).
  return record("sms", to, null, body, related, `dev-sms-${Date.now()}`);
}

/** Print-and-mail vendor (Lob): first-class mail with certificate of mailing. Returns a tracking id. */
export async function sendPrintMail(toName: string, addressLines: string[], description: string, related: Related = {}) {
  const tracking = `dev-mail-${Date.now().toString(36)}`;
  await record("mail", `${toName}, ${addressLines.join(", ")}`, description, `First-class mail with certificate of mailing: ${description}`, related, tracking);
  return tracking;
}

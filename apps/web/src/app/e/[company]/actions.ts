"use server";

import {
  acknowledgeNotice,
  addPaymentMethod,
  createEnrolleeAccount,
  getEnrolleeView,
  loginEnrollee,
  openTask,
  payInvoice,
  startVerification,
  submitElections,
  UserError,
  verifyCode,
} from "@cod/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bool, str, toFormError, type FormState } from "@/lib/actions";
import { clientIp, requireEnrollee, userAgent } from "@/lib/auth";
import { clearSessions, setEnrolleeSession } from "@/lib/session";

export async function startVerificationAction(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  let target: string;
  try {
    const r = await startVerification({ slug, eventDate: str(fd, "eventDate"), last4: str(fd, "last4"), dob: str(fd, "dob"), ip: await clientIp() });
    const params = new URLSearchParams({ q: r.qbId, to: r.sentTo });
    if (r.devCode) params.set("dev", r.devCode);
    target = `/e/${slug}/verify?${params}`;
  } catch (err) {
    return toFormError(err);
  }
  redirect(target);
}

export async function verifyCodeAction(slug: string, qbId: string, _: FormState, fd: FormData): Promise<FormState> {
  let status: string;
  try {
    const s = await verifyCode(qbId, str(fd, "code"));
    await setEnrolleeSession({ ...s, slug });
    status = (await getEnrolleeView(s.qbId)).me.status;
  } catch (err) {
    return toFormError(err);
  }
  redirect(status === "notice_sent" || status === "waived" ? `/e/${slug}/elect` : `/e/${slug}/account`);
}

export async function enrolleeLoginAction(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await loginEnrollee(slug, str(fd, "email"), str(fd, "password"));
  if (!s) return { error: "That email and password don't match." };
  await setEnrolleeSession({ ...s, slug });
  redirect(`/e/${slug}/account`);
}

export async function enrolleeLogoutAction(slug: string) {
  await clearSessions();
  redirect(`/e/${slug}`);
}

export async function acknowledgeAction(slug: string, documentSha256: string | undefined) {
  const { session } = await requireEnrollee(slug);
  await acknowledgeNotice(session.qbId, { ip: await clientIp(), userAgent: await userAgent(), documentSha256 });
}

export async function submitElectionAction(slug: string, payload: { decisions: Record<string, Record<string, "elect" | "waive">>; signedName: string; stateNoticesReviewed: boolean }): Promise<FormState> {
  let code: string;
  try {
    const { session } = await requireEnrollee(slug);
    const r = await submitElections({ actorQbId: session.qbId, ...payload, ip: await clientIp() });
    code = r.confirmationCode;
  } catch (err) {
    return toFormError(err);
  }
  redirect(`/e/${slug}/account?confirmed=${code}`);
}

export async function createAccountAction(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { session } = await requireEnrollee(slug);
    if (str(fd, "password") !== str(fd, "confirm")) throw new UserError("Passwords don't match.", "confirm");
    await createEnrolleeAccount(session.qbId, str(fd, "email"), str(fd, "password"));
    revalidatePath(`/e/${slug}/account`);
    return { ok: "Account created. Next, add a payment method." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function addMethodAction(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { session, actor } = await requireEnrollee(slug);
    const view = await getEnrolleeView(session.qbId);
    if (!view.account) throw new UserError("Create your account first.");
    await addPaymentMethod(view.account.id, str(fd, "type") === "card" ? "card" : "ach", bool(fd, "autopay"), actor);
    revalidatePath(`/e/${slug}/account`);
    return { ok: "Payment method saved." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function payAction(slug: string, invoiceId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { session, actor } = await requireEnrollee(slug);
    const view = await getEnrolleeView(session.qbId);
    if (!view.invoices.some((i) => i.id === invoiceId)) throw new UserError("Invoice not found.");
    await payInvoice(invoiceId, str(fd, "methodId"), actor);
  } catch (err) {
    return toFormError(err);
  }
  // The paid invoice leaves the open list, so confirm on the page itself.
  redirect(`/e/${slug}/account?paid=1`);
}

/** NOT-12: a free paper copy on request. */
export async function paperCopyAction(slug: string, _: FormState): Promise<FormState> {
  try {
    const { session } = await requireEnrollee(slug);
    const view = await getEnrolleeView(session.qbId);
    await openTask({ companyId: view.me.companyId, type: "paper_copy_request", title: `Paper copy requested by ${view.me.firstName} ${view.me.lastName}`, detail: "Mail a free paper copy of every notice.", entityType: "qualified_beneficiary", entityId: view.me.id });
    return { ok: "A free paper copy will be mailed to the address we have on file." };
  } catch (err) {
    return toFormError(err);
  }
}

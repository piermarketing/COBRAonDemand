"use server";

import { recordConsent, withdrawConsent } from "@cod/core";
import { revalidatePath } from "next/cache";
import { str, toFormError, type FormState } from "@/lib/actions";
import { clientIp, userAgent } from "@/lib/auth";

export async function consentAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    await recordConsent(token, { email: str(fd, "email"), testPdfOpened: str(fd, "testPdfOpened") === "yes", ip: await clientIp(), userAgent: await userAgent() });
    revalidatePath(`/consent/${token}`);
    return { ok: "Thank you. Your consent is recorded. You can withdraw it at any time from this page." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function withdrawAction(token: string, _: FormState): Promise<FormState> {
  try {
    await withdrawConsent(token, { ip: await clientIp() });
    revalidatePath(`/consent/${token}`);
    return { ok: "Consent withdrawn. Future notices will be mailed to you at no cost." };
  } catch (err) {
    return toFormError(err);
  }
}

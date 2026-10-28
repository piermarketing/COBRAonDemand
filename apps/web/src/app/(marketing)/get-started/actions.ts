"use server";

import { signUpEmployer, signupSchema } from "@cod/core";
import { redirect } from "next/navigation";
import { toFormError, type FormState } from "@/lib/actions";
import { clientIp, userAgent } from "@/lib/auth";
import { setUserSession } from "@/lib/session";

export async function signUpAction(_: FormState, fd: FormData): Promise<FormState> {
  let userId: string;
  try {
    const input = signupSchema.parse({
      ...Object.fromEntries(fd),
      acceptTerms: fd.get("acceptTerms") === "on",
      confirmAuthority: fd.get("confirmAuthority") === "on",
    });
    const { user } = await signUpEmployer(input, { ip: await clientIp(), userAgent: await userAgent() });
    userId = user.id;
  } catch (err) {
    return toFormError(err);
  }
  await setUserSession({ userId, kind: "employer" });
  redirect("/dashboard/setup");
}

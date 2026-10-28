"use server";

import { authenticateUser } from "@cod/core";
import { redirect } from "next/navigation";
import { str, type FormState } from "@/lib/actions";
import { clearSessions, setUserSession } from "@/lib/session";

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await authenticateUser(str(fd, "email"), str(fd, "password"));
  if (!user) return { error: "That email and password don't match." };
  await setUserSession({ userId: user.id, kind: user.kind });
  redirect(user.kind === "ops" ? "/ops" : "/dashboard");
}

export async function logoutAction() {
  await clearSessions();
  redirect("/");
}

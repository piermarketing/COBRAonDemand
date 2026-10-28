"use server";

import { replacePriceTiers, resolveTask, runAllJobs, runJob, type JobName } from "@cod/core";
import type { PriceTier } from "@cod/billing";
import { revalidatePath } from "next/cache";
import { str, toFormError, type FormState } from "@/lib/actions";
import { requireOps } from "@/lib/auth";

export async function resolveTaskAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { actor } = await requireOps();
    await resolveTask(taskId, str(fd, "resolution"), actor);
    revalidatePath("/ops");
    return { ok: "Resolved." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function runJobAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await requireOps();
    const name = str(fd, "job");
    const result = name === "all" ? await runAllJobs() : await runJob(name as JobName);
    revalidatePath("/ops", "layout");
    return { ok: `${name}: ${JSON.stringify(result)}` };
  } catch (err) {
    return toFormError(err);
  }
}

export async function savePricingAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { actor } = await requireOps();
    const tiers: PriceTier[] = [];
    for (let i = 0; i < 5; i++) {
      const min = str(fd, `min_${i}`);
      const price = str(fd, `price_${i}`);
      if (!min && !price) continue;
      const max = str(fd, `max_${i}`);
      tiers.push({ min: Number(min), max: max ? Number(max) : null, unitPrice: Math.round(Number(price) * 100), plan: "standard" });
    }
    await replacePriceTiers(tiers, str(fd, "reason"), actor);
    revalidatePath("/ops/pricing");
    return { ok: "Pricing updated. New charges use these tiers." };
  } catch (err) {
    return toFormError(err);
  }
}

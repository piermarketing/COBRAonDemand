"use server";

import {
  addBillingMethodDev,
  cancelEvent,
  confirmEvent,
  confirmModule,
  connectSandbox,
  createQualifyingEvent,
  goLive,
  importCensus,
  importPlansFile,
  openTask,
  profileSchema,
  saveManualPlan,
  setModuleStatus,
  simulateSandboxChange,
  updateCompanyProfile,
  updateSettings,
  UserError,
} from "@cod/core";
import { SETUP_MODULES, type SetupModule } from "@cod/db";
import { PLAN_TYPES, QUALIFYING_EVENT_TYPES, TIERS, type PlanType, type QualifyingEventType } from "@cod/rules";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bool, str, toFormError, type FormState } from "@/lib/actions";
import { requireWriter } from "@/lib/auth";

function moduleParam(v: string): SetupModule {
  if (!(SETUP_MODULES as readonly string[]).includes(v)) throw new UserError("Unknown setup module.");
  return v as SetupModule;
}

async function fileText(fd: FormData, key: string): Promise<string> {
  const f = fd.get(key);
  if (f instanceof File && f.size > 0) {
    if (f.size > 5 * 1024 * 1024) throw new UserError("Files must be under 5 MB.");
    if (!/\.(csv|txt)$/i.test(f.name)) throw new UserError("Upload a .csv file. Save Excel files as CSV first.");
    return f.text();
  }
  const pasted = str(fd, `${key}Text`);
  if (pasted) return pasted;
  throw new UserError("Choose a file to upload.");
}

export async function goLiveAction(_: FormState): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    await goLive(company.id, actor);
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard?live=1");
}

export async function saveProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    const regime = await updateCompanyProfile(company.id, profileSchema.parse(Object.fromEntries(fd)), actor);
    revalidatePath("/dashboard", "layout");
    return regime.supported ? { ok: "Company profile saved." } : { error: regime.reason };
  } catch (err) {
    return toFormError(err);
  }
}

export async function connectSandboxAction(_: FormState): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    const { summary } = await connectSandbox(company.id, actor);
    revalidatePath("/dashboard", "layout");
    return {
      ok: `Connected. Imported ${summary.employees.added} employees, ${summary.dependents.added} dependents, ${summary.plans.added} plans and ${summary.coverages.added} elections. Review each module and confirm.`,
    };
  } catch (err) {
    return toFormError(err);
  }
}

export async function uploadCensusAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    const result = await importCensus(company.id, await fileText(fd, "census"), actor);
    if (!result.ok) {
      return { error: `The file has ${result.errors.length} problem(s). Fix them and upload again.`, data: { errors: result.errors.slice(0, 50), warnings: result.warnings.slice(0, 50) } };
    }
    revalidatePath("/dashboard", "layout");
    const s = result.summary;
    return {
      ok: `Imported ${s.employees.added + s.employees.updated} employees, ${s.dependents.added + s.dependents.updated} dependents and ${s.coverages.added} elections.`,
      data: { warnings: result.warnings.slice(0, 50), errors: [] },
    };
  } catch (err) {
    return toFormError(err);
  }
}

export async function uploadPlansAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    const result = await importPlansFile(company.id, await fileText(fd, "plans"), actor);
    if (!result.ok) return { error: `The rate sheet has ${result.errors.length} problem(s).`, data: { errors: result.errors.slice(0, 50), warnings: [] } };
    revalidatePath("/dashboard", "layout");
    return { ok: `Imported ${result.summary.plans.added + result.summary.plans.updated} plans.` };
  } catch (err) {
    return toFormError(err);
  }
}

export async function savePlanAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    const type = str(fd, "type") as PlanType;
    if (!PLAN_TYPES.includes(type)) throw new UserError("Choose a plan type.", "type");
    const rates = Object.fromEntries(TIERS.map((t) => [t, str(fd, `rate_${t}`) ? Number(str(fd, `rate_${t}`).replace(/[$,]/g, "")) : undefined]));
    await saveManualPlan(
      company.id,
      {
        code: str(fd, "code") || str(fd, "name").toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20),
        carrierName: str(fd, "carrierName"),
        name: str(fd, "name"),
        type,
        groupNumber: str(fd, "groupNumber") || undefined,
        insured: str(fd, "funding") !== "self",
        coverageEndRule: str(fd, "coverageEndRule") === "termination_date" ? "termination_date" : "end_of_month",
        rates,
      },
      actor,
    );
    revalidatePath("/dashboard/setup/plans");
    return { ok: "Plan saved." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function confirmModuleAction(module: string, _: FormState): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    await confirmModule(company.id, moduleParam(module), actor);
    revalidatePath("/dashboard", "layout");
  } catch (err) {
    return toFormError(err);
  }
  redirect("/dashboard/setup");
}

export async function addBillingAction(_: FormState): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    await addBillingMethodDev(company.id, actor);
    revalidatePath("/dashboard", "layout");
    return { ok: "Payment method on file. Nothing is charged until the first packet is sent." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function saveSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    const days = Number(str(fd, "autoProceedDays"));
    if (!Number.isInteger(days) || days < 0 || days > 10) throw new UserError("Hold between 0 and 10 days.", "autoProceedDays");
    const months = Number(str(fd, "subsidyMonths") || 0);
    const percent = Number(str(fd, "subsidyPercent") || 0);
    if (months < 0 || months > 18 || percent < 0 || percent > 100) throw new UserError("Subsidy must be 0–18 months and 0–100%.");
    await updateSettings(
      company.id,
      {
        sendMode: str(fd, "sendMode") === "immediate" ? "immediate" : "hold",
        autoProceedDays: days,
        defaultSubsidy: months > 0 && percent > 0 ? { months, percent } : null,
        remindersEnabled: bool(fd, "remindersEnabled"),
      },
      actor,
    );
    revalidatePath("/dashboard", "layout");
    return { ok: "Automation settings saved." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function currentCobraAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    if (str(fd, "choice") === "none") {
      await setModuleStatus(company.id, "current_cobra", "complete", { source: "manual", userId: actor.id ?? undefined });
      revalidatePath("/dashboard", "layout");
      return { ok: "Marked as no current COBRA enrollees." };
    }
    await openTask({ companyId: company.id, type: "takeover", title: `Takeover file requested: ${company.legalName}`, detail: str(fd, "notes") || "Employer has current COBRA enrollees with a prior administrator." });
    await setModuleStatus(company.id, "current_cobra", "in_progress", { source: "prior_administrator_file" });
    revalidatePath("/dashboard", "layout");
    return { ok: "Our team will contact you to load the prior administrator's file (paid-through dates and months remaining)." };
  } catch (err) {
    return toFormError(err);
  }
}

export async function simulateTerminationAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX !== "true") throw new UserError("The sandbox is disabled in production.");
    const { company, actor } = await requireWriter();
    const employeeSourceId = str(fd, "employeeSourceId");
    const result =
      str(fd, "kind") === "rehire"
        ? await simulateSandboxChange(company.id, { kind: "rehire", employeeSourceId }, actor)
        : await simulateSandboxChange(company.id, { kind: "terminate", employeeSourceId, terminationDate: str(fd, "terminationDate"), reason: str(fd, "reason") || "voluntary" }, actor);
    revalidatePath("/dashboard", "layout");
    return { ok: `Sync ran: ${result.detected.length} change(s) detected, ${result.eventsCreated.length} qualifying event(s) created.` };
  } catch (err) {
    return toFormError(err);
  }
}

export async function reportEventAction(_: FormState, fd: FormData): Promise<FormState> {
  let id: string;
  try {
    const { company, actor } = await requireWriter();
    if (company.status !== "live") throw new UserError("Go live before reporting events.");
    const type = str(fd, "type") as QualifyingEventType;
    if (!QUALIFYING_EVENT_TYPES.includes(type)) throw new UserError("Choose an event type.", "type");
    const months = Number(str(fd, "subsidyMonths") || 0);
    const percent = Number(str(fd, "subsidyPercent") || 0);
    const gm = bool(fd, "grossMisconduct");
    const r = await createQualifyingEvent({
      companyId: company.id,
      employeeId: str(fd, "employeeId"),
      type,
      eventDate: str(fd, "eventDate"),
      lastCoveredDay: str(fd, "lastCoveredDay") || undefined,
      dependentId: str(fd, "dependentId") || undefined,
      source: "manual",
      reason: str(fd, "reason") || undefined,
      grossMisconduct: gm ? { reason: str(fd, "grossMisconductReason"), confirmed: bool(fd, "grossMisconductConfirm") } : undefined,
      subsidy: months > 0 && percent > 0 ? { months, percent } : undefined,
      actor,
    });
    id = r.id;
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/events/${id}`);
}

export async function confirmEventAction(eventId: string, _: FormState): Promise<FormState> {
  try {
    const { company, actor } = await requireWriter();
    await confirmEvent(company.id, eventId, actor);
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/events/${eventId}?done=sent`);
}

export async function cancelEventAction(eventId: string, _: FormState, fd: FormData): Promise<FormState> {
  let cancelled: boolean;
  try {
    const { company, actor } = await requireWriter();
    const reason = str(fd, "reason");
    if (reason.length < 3) throw new UserError("Say why (for example: rehired, entered in error).", "reason");
    cancelled = (await cancelEvent(company.id, eventId, reason, actor)).cancelled;
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/events/${eventId}?done=${cancelled ? "cancelled" : "reversal"}`);
}

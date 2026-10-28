import type { CanonicalDependent, CanonicalEmployee, CanonicalEnrollment, DetectedEvent } from "./canonical";

/** A drop below this many weekly hours, with coverage ending, can be a reduction-in-hours event. */
export const BENEFITS_ELIGIBLE_WEEKLY_HOURS = 30;

export interface SyncSnapshot {
  employees: CanonicalEmployee[];
  dependents: CanonicalDependent[];
  enrollments: CanonicalEnrollment[];
}

/**
 * Diff two syncs to find qualifying events (INT-9, INT-13, INT-14, TRG-2,
 * TRG-9, TRG-10, QE-4). Field-by-field comparison, so it works the same for a
 * daily reconciliation pull or a webhook-triggered fetch.
 */
export function detectEvents(prev: SyncSnapshot, next: SyncSnapshot, asOf: string = new Date().toISOString().slice(0, 10)): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  const prevById = new Map(prev.employees.map((e) => [e.sourceId, e]));
  const enrolledNow = new Set(next.enrollments.filter((e) => !e.endDate).map((e) => e.personSourceId));
  const enrolledBefore = new Set(prev.enrollments.filter((e) => !e.endDate).map((e) => e.personSourceId));

  for (const emp of next.employees) {
    const before = prevById.get(emp.sourceId);

    if (emp.terminationDate && emp.terminationDate !== before?.terminationDate) {
      events.push({
        kind: "termination",
        employeeSourceId: emp.sourceId,
        eventDate: emp.terminationDate,
        reason: emp.terminationReason,
        detail: before?.terminationDate
          ? `Termination date changed from ${before.terminationDate} to ${emp.terminationDate}.`
          : `New termination date ${emp.terminationDate}.`,
      });
      continue;
    }

    if (before?.terminationDate && !emp.terminationDate) {
      events.push({
        kind: emp.status === "active" ? "rehire" : "termination_cancelled",
        employeeSourceId: emp.sourceId,
        eventDate: before.terminationDate,
        detail: "Termination removed in the source system.",
      });
      continue;
    }

    if (
      before &&
      !emp.terminationDate &&
      before.weeklyHours !== undefined &&
      emp.weeklyHours !== undefined &&
      before.weeklyHours >= BENEFITS_ELIGIBLE_WEEKLY_HOURS &&
      emp.weeklyHours < BENEFITS_ELIGIBLE_WEEKLY_HOURS &&
      enrolledBefore.has(emp.sourceId) &&
      !enrolledNow.has(emp.sourceId)
    ) {
      events.push({
        kind: "reduction_in_hours",
        employeeSourceId: emp.sourceId,
        eventDate: asOf,
        detail: `Weekly hours dropped from ${before.weeklyHours} to ${emp.weeklyHours} and coverage ended.`,
      });
    }
  }

  const nextDepIds = new Set(next.dependents.map((d) => d.sourceId));
  for (const dep of prev.dependents) {
    const parentTerminated = next.employees.find((e) => e.sourceId === dep.employeeSourceId)?.terminationDate;
    if (parentTerminated) continue;
    const removed = !nextDepIds.has(dep.sourceId) || (enrolledBefore.has(dep.sourceId) && !enrolledNow.has(dep.sourceId));
    if (removed && enrolledBefore.has(dep.sourceId)) {
      events.push({
        kind: "dependent_removed",
        employeeSourceId: dep.employeeSourceId,
        dependentSourceId: dep.sourceId,
        eventDate: asOf,
        detail: `${dep.firstName} ${dep.lastName} was removed from coverage; needs employer review (divorce, aging out?).`,
      });
    }
  }

  return events;
}

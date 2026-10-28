"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { daysBetween, deriveTier, formatCents, TIER_LABELS, type Relationship, type Tier } from "@cod/rules";
import { NoticeView, type NoticeDoc } from "@/components/notice-view";
import { Alert, Button, cn, Input, Label } from "@/components/ui";
import { acknowledgeAction, submitElectionAction } from "../actions";

type Person = { id: string; name: string; relationship: Relationship; deadline: string | null };
type Plan = { planId: string; name: string; carrier: string; type: string; originalTier: Tier; rates: { tier: Tier; label: string; monthly: number }[]; coveredQbIds: string[] };
type Decision = "elect" | "waive";

const STEPS = ["Your notice", "Plans and costs", "Other options", "Review and sign"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-6 grid grid-cols-4 gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className={cn("rounded-md border px-2 py-2 text-center", i === current ? "border-brand bg-brand-light font-semibold text-brand-dark" : i < current ? "border-ok/30 bg-ok-light text-ok" : "border-line bg-white text-ink-muted")}>
          <span className="hidden sm:inline">{i + 1}. </span>
          {s}
        </li>
      ))}
    </ol>
  );
}

function ScrollToRead({ children, onReachedEnd }: { children: React.ReactNode; onReachedEnd: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    // Short content that needs no scrolling counts as read.
    if (el && el.scrollHeight <= el.clientHeight + 24) onReachedEnd();
  }, [onReachedEnd]);
  return (
    <div
      ref={ref}
      onScroll={() => {
        const el = ref.current;
        if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) onReachedEnd();
      }}
      className="max-h-[60vh] space-y-8 overflow-y-auto rounded-md border border-line bg-white p-5"
      tabIndex={0}
      aria-label="Notice text"
    >
      {children}
    </div>
  );
}

export function ElectionWizard(props: {
  slug: string;
  today: string;
  state: string;
  noticeId: string | null;
  acknowledged: boolean;
  deadline: string;
  me: { id: string; firstName: string };
  people: Person[];
  plans: Plan[];
  noticeDocs: NoticeDoc[];
  stateDocs: NoticeDoc[];
}) {
  const [step, setStep] = useState(0);
  const [readNotice, setReadNotice] = useState(props.acknowledged);
  const [ack, setAck] = useState(props.acknowledged);
  const [readState, setReadState] = useState(false);
  const [stateReviewed, setStateReviewed] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [decisions, setDecisions] = useState<Record<string, Record<string, Decision>>>(() =>
    Object.fromEntries(props.people.map((p) => [p.id, Object.fromEntries(props.plans.filter((pl) => pl.coveredQbIds.includes(p.id)).map((pl) => [pl.planId, "elect" as Decision]))])),
  );
  const daysLeft = daysBetween(props.today, props.deadline);

  const pricing = useMemo(
    () =>
      props.plans.map((pl) => {
        const electing = props.people.filter((p) => decisions[p.id]?.[pl.planId] === "elect");
        const tier = deriveTier(electing.map((p) => p.relationship));
        const rate = tier ? pl.rates.find((r) => r.tier === tier) ?? pl.rates.find((r) => r.tier === pl.originalTier) : undefined;
        return { plan: pl, electing, tier, monthly: rate?.monthly ?? 0 };
      }),
    [decisions, props.plans, props.people],
  );
  const total = pricing.reduce((s, p) => s + p.monthly, 0);
  const anyElect = pricing.some((p) => p.electing.length > 0);

  const set = (qbId: string, planId: string, d: Decision) => setDecisions((cur) => ({ ...cur, [qbId]: { ...cur[qbId], [planId]: d } }));

  return (
    <div>
      <div className={cn("mb-4 rounded-md px-4 py-3 text-sm", daysLeft <= 14 ? "bg-warn-light text-warn" : "bg-brand-light text-brand-dark")} role="status">
        <strong>Election deadline: {new Date(`${props.deadline}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong> · {daysLeft} days left. Electing later still gives you coverage back to the day it ended, as long as you pay on time.
      </div>
      <Steps current={step} />
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">Read your COBRA election notice. You can also download the full packet as a PDF.</p>
          <ScrollToRead onReachedEnd={() => setReadNotice(true)}>
            {props.noticeDocs.map((d) => <NoticeView key={d.id} doc={d} />)}
          </ScrollToRead>
          {props.noticeId && (
            <a href={`/api/notices/${props.noticeId}/pdf`} className="inline-block text-sm text-brand underline">
              Download the full packet (PDF)
            </a>
          )}
          <label className={cn("flex items-start gap-2 text-sm", !readNotice && "text-ink-muted")}>
            <input type="checkbox" disabled={!readNotice} checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            <span>I have received this notice. {!readNotice && "(Scroll to the end to enable.)"} <span className="block text-xs text-ink-muted">This only confirms you received it. It does not agree to anything.</span></span>
          </label>
          <Button
            disabled={!ack || pending}
            onClick={() =>
              startTransition(async () => {
                if (!props.acknowledged) await acknowledgeAction(props.slug, undefined);
                setStep(1);
              })
            }
          >
            Continue
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <p className="text-sm text-ink-soft">For each plan, choose who keeps coverage. Each person can decide differently. You can drop people or plans, but not add anyone.</p>
          {pricing.map(({ plan, tier, monthly }) => (
            <section key={plan.planId} className="rounded-lg border border-line bg-white">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <div>
                  <h3 className="font-semibold text-ink">{plan.name}</h3>
                  <p className="text-xs text-ink-muted">{plan.carrier} · {plan.type}</p>
                </div>
                <p className="text-sm">
                  {tier ? <><span className="text-ink-muted">{TIER_LABELS[tier]}:</span> <strong className="tabular-nums">{formatCents(monthly)}/mo</strong></> : <span className="text-ink-muted">Waived</span>}
                </p>
              </div>
              <div className="overflow-x-auto px-4 py-3">
                <table className="text-xs">
                  <tbody>
                    <tr className="text-ink-muted">{plan.rates.map((r) => <td key={r.tier} className={cn("pr-4", r.tier === plan.originalTier && "font-semibold text-ink")}>{r.label}</td>)}</tr>
                    <tr className="tabular-nums">{plan.rates.map((r) => <td key={r.tier} className="pr-4">{formatCents(r.monthly)}</td>)}</tr>
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {props.people.filter((p) => plan.coveredQbIds.includes(p.id)).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span>{p.name} <span className="text-xs text-ink-muted">({p.relationship})</span></span>
                    <span className="inline-flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label={`${p.name}, ${plan.name}`}>
                      {(["elect", "waive"] as const).map((d) => (
                        <button key={d} type="button" role="radio" aria-checked={decisions[p.id]?.[plan.planId] === d} onClick={() => set(p.id, plan.planId, d)} className={cn("px-3 py-1 text-xs font-medium", decisions[p.id]?.[plan.planId] === d ? (d === "elect" ? "bg-brand text-white" : "bg-ink-soft text-white") : "bg-white text-ink-soft")}>
                          {d === "elect" ? "Elect" : "Waive"}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3">
            <span className="text-sm text-ink-soft">Total monthly premium (100% of plan cost, no fees added)</span>
            <strong className="text-lg tabular-nums">{formatCents(total)}</strong>
          </div>
          <a href={props.state === "CA" ? "https://www.coveredca.com" : "https://www.healthcare.gov"} target="_blank" rel="noreferrer" className="inline-block text-sm text-brand underline">
            Compare on {props.state === "CA" ? "Covered California" : "HealthCare.gov"}
          </a>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)}>Continue</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">Before you decide, read about your other options. {props.state === "CA" && "California requires these notices before you can decline coverage."}</p>
          <ScrollToRead onReachedEnd={() => setReadState(true)}>
            {props.stateDocs.map((d) => <NoticeView key={d.id} doc={d} />)}
          </ScrollToRead>
          <label className={cn("flex items-start gap-2 text-sm", !readState && "text-ink-muted")}>
            <input type="checkbox" disabled={!readState} checked={stateReviewed} onChange={(e) => setStateReviewed(e.target.checked)} className="mt-1" />
            <span>I have reviewed these notices. {!readState && "(Scroll to the end to enable.)"}</span>
          </label>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <Button disabled={!stateReviewed} onClick={() => setStep(3)}>Continue</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-white p-4">
            <h3 className="font-semibold text-ink">Your choices</h3>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {props.people.map((p) => (
                <li key={p.id}>
                  <strong className="text-ink">{p.name}:</strong>{" "}
                  {props.plans.filter((pl) => pl.coveredQbIds.includes(p.id)).map((pl) => `${pl.name} ${decisions[p.id]?.[pl.planId] === "elect" ? "elected" : "waived"}`).join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm">
              Monthly premium: <strong className="tabular-nums">{formatCents(total)}</strong>
              {anyElect && <span className="text-ink-muted"> · first payment due within 45 days, covering every month since your coverage ended</span>}
            </p>
          </div>
          {!anyElect && <Alert tone="warn" title="You are waiving all coverage">You can still change your mind and elect before the deadline.</Alert>}
          <div>
            <Label htmlFor="sig">Type your full name to sign electronically</Label>
            <Input id="sig" value={signedName} onChange={(e) => setSignedName(e.target.value)} autoComplete="name" />
            <p className="mt-1 text-xs text-ink-muted">Your typed name is your electronic signature under the federal ESIGN Act and California UETA. We record the time and your IP address.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
            <Button
              disabled={signedName.trim().length < 3 || pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await submitElectionAction(props.slug, { decisions, signedName, stateNoticesReviewed: stateReviewed });
                  if (r?.error) setError(r.error);
                })
              }
            >
              {pending ? "Submitting…" : "Sign and submit"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { activePriceTiers } from "@cod/core";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { savePricingAction } from "../actions";

export const metadata = { title: "Ops · Pricing" };

export default async function Pricing() {
  const tiers = await activePriceTiers();
  const rows = Array.from({ length: 5 }, (_, i) => tiers[i]);
  return (
    <>
      <PageHeader title="Pricing tiers" subtitle="One rate per packet sent and per active enrollee month. Units = packets + enrollee months in a month; the tier reached applies to every unit." />
      <Card>
        <ActionForm action={savePricingAction} className="space-y-4">
          {rows.map((t, i) => (
            <div key={i} className="grid grid-cols-3 gap-3">
              <Field label={i === 0 ? "From (units)" : ""}><Input name={`min_${i}`} type="number" min={0} defaultValue={t?.min ?? ""} /></Field>
              <Field label={i === 0 ? "To (blank = no limit)" : ""}><Input name={`max_${i}`} type="number" min={0} defaultValue={t?.max ?? ""} /></Field>
              <Field label={i === 0 ? "Price per unit ($)" : ""}><Input name={`price_${i}`} inputMode="decimal" defaultValue={t ? (t.unitPrice / 100).toFixed(2) : ""} /></Field>
            </div>
          ))}
          <Field label="Reason for the change (logged)"><Input name="reason" required /></Field>
          <SubmitButton>Save pricing</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}

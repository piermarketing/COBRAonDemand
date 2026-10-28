import { listOutbox } from "@cod/core";
import { Badge, Card, PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Ops · Outbox" };

export default async function Outbox() {
  const messages = await listOutbox(150);
  return (
    <>
      <PageHeader title="Outbox" subtitle="Every email, text and mailed notice, stored against its record. Until provider keys are set, messages are recorded here instead of being sent." />
      <div className="space-y-3">
        {messages.map((m) => (
          <Card key={m.id}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <Badge tone={m.channel === "mail" ? "warn" : "brand"}>{m.channel}</Badge>
              <span>to {m.to}</span>
              <span>· {dateTime(m.createdAt)}</span>
              <span>· {m.status}</span>
            </div>
            {m.subject && <p className="mt-2 font-medium text-ink">{m.subject}</p>}
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-ink-soft">{m.body}</pre>
          </Card>
        ))}
        {messages.length === 0 && <Card><p className="text-sm text-ink-muted">No messages yet.</p></Card>}
      </div>
    </>
  );
}

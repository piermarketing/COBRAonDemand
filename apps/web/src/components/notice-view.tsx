export interface NoticeSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  callout?: string;
}
export interface NoticeDoc {
  id: string;
  title: string;
  templateVersion: string;
  rule: string;
  sections: NoticeSection[];
}

/** Inline rendering of a packet document, the same content as the PDF. */
export function NoticeView({ doc }: { doc: NoticeDoc }) {
  return (
    <article className="prose-notice">
      <h2 className="text-lg font-semibold text-ink">{doc.title}</h2>
      <p className="text-xs text-ink-muted">
        {doc.rule} · {doc.templateVersion}
      </p>
      {doc.sections.map((s, i) => (
        <section key={i}>
          {s.heading && <h3>{s.heading}</h3>}
          {s.paragraphs?.map((p, j) => (
            <p key={j} className="whitespace-pre-line">
              {p}
            </p>
          ))}
          {s.callout && <p className="rounded-md bg-brand-light px-3 py-2 font-semibold text-brand-dark">{s.callout}</p>}
          {s.bullets && (
            <ul>
              {s.bullets.map((b, j) => (
                <li key={j}>{b}</li>
              ))}
            </ul>
          )}
          {s.table && (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    {s.table.headers.map((h) => (
                      <th key={h} className="py-1 pr-4 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((r, j) => (
                    <tr key={j} className="border-b border-line last:border-0">
                      {r.map((c, k) => (
                        <td key={k} className="py-1 pr-4 text-ink-soft">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </article>
  );
}

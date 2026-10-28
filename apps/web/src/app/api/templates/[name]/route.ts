import { censusTemplateCsv, plansTemplateCsv } from "@cod/integrations";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = name === "census" ? censusTemplateCsv() : name === "plans" ? plansTemplateCsv() : null;
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="cobra-on-demand-${name}-template.csv"` } });
}

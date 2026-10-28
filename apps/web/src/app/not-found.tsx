import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-soft">The link may be wrong, or this COBRA portal isn&apos;t live yet.</p>
      <Link href="/" className="mt-6 inline-block text-brand underline">
        Go to COBRA on Demand
      </Link>
    </div>
  );
}

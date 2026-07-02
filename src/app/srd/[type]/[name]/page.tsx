import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSRDBySlug } from "@/lib/srd/search";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ type: string; name: string }> };

export default async function SRDDetailPage({ params }: Props) {
  const { type, name } = await params;
  const slug = `${type}/${name}`;
  const hit = await getSRDBySlug(slug);

  if (!hit) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-ink-100">No SRD entry at this slug.</p>
        <Link href="/srd" className="mt-4 inline-block text-brass-300 hover:text-brass-200">
          ← back to browser
        </Link>
      </main>
    );
  }

  const meta = (hit.data ?? {}) as Record<string, unknown>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/srd"
        className="font-display text-xs uppercase tracking-[0.3em] text-brass-400 hover:text-brass-300"
      >
        ← SRD browser
      </Link>

      <header className="mt-4 mb-6">
        <span className="rounded-full border border-brass-700/40 bg-ink-600/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass-300">
          {hit.type}
        </span>
        <h1 className="mt-2 font-display text-4xl text-parchment-100">
          {hit.name}
        </h1>
        <p className="mt-1 text-xs text-ink-200">{hit.source}</p>
      </header>

      {Object.keys(meta).length > 0 ? (
        <dl className="panel mb-6 grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-3">
          {Object.entries(meta)
            .slice(0, 12)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-brass-400">
                  {k.replace(/_/g, " ")}
                </dt>
                <dd className="text-parchment-200">{String(v)}</dd>
              </div>
            ))}
        </dl>
      ) : null}

      <article className="prose prose-invert max-w-none font-serif">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{hit.content}</ReactMarkdown>
      </article>
    </main>
  );
}

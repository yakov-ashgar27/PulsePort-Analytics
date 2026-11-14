import { Check, Copy, Download, FileText, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useApi } from "../hooks/useApi";
import { ErrorState, Loading, VerdictBadge } from "./ui";

export default function ExecutiveBriefModal({ onClose }: { onClose: () => void }) {
  const brief = useApi((s) => api.brief(s), []);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const copy = async () => {
    if (!brief.data) return;
    await navigator.clipboard.writeText(brief.data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const download = () => {
    if (!brief.data) return;
    const blob = new Blob([brief.data.markdown], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pulseport-management-brief-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="brief-title"
        className="w-full max-w-4xl rounded-2xl border border-line bg-surface shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-2xl border-b border-line bg-surface px-6 py-4">
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-brand" aria-hidden />
            <div>
              <h2 id="brief-title" className="font-semibold text-ink">
                {brief.data?.title ?? "Management Brief"}
              </h2>
              {brief.data && (
                <p className="text-xs text-ink-3">
                  {brief.data.generated_at} · α = {brief.data.alpha} · target power {Math.round(brief.data.power * 100)}% · every figure computed, none generated
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              disabled={!brief.data}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-good" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy Markdown"}
            </button>
            <button
              onClick={download}
              disabled={!brief.data}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> .md
            </button>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="px-6 py-5">
          {brief.error ? (
            <ErrorState error={brief.error} onRetry={brief.reload} />
          ) : !brief.data ? (
            <Loading label="Synthesising experiment, benchmark and SLA findings…" />
          ) : (
            <>
              <section className="mb-6 rounded-xl border border-line bg-surface-2 p-4">
                <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-3 uppercase">Executive summary</h3>
                <ul className="space-y-2">
                  {brief.data.sections.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-ink">{s.title}</span>
                      <VerdictBadge verdict={s.verdict} />
                    </li>
                  ))}
                </ul>
              </section>

              <div className="space-y-6">
                {brief.data.sections.map((s) => (
                  <article key={s.id} className="border-b border-line pb-6 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[11px] font-semibold tracking-wide text-ink-3">{s.id}</span>
                      <h3 className="text-base font-semibold text-ink">{s.title}</h3>
                      <VerdictBadge verdict={s.verdict} />
                    </div>
                    <dl className="mt-3 space-y-3 text-sm">
                      <Row label="Hypothesis">{s.hypothesis}</Row>
                      <Row label="Statistical evidence">
                        <ul className="tabular list-disc space-y-1 pl-4 text-ink-2">
                          {s.evidence.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </Row>
                      <Row label="Risk assessment">{s.risk}</Row>
                      <Row label="Recommendation">
                        <span className="font-medium text-ink">{s.recommendation}</span>
                      </Row>
                    </dl>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[170px_1fr]">
      <dt className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className="text-ink-2">{children}</dd>
    </div>
  );
}

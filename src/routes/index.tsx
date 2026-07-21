import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { store } from "@/lib/store";
import { checkSyncStatus } from "@/lib/enrichment.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Memory Center — Soul-centric Dialer" },
      {
        name: "description",
        content: "A power dialer for Chino. Notion CRM, motivation cards, and a 60-second pitch before every call.",
      },
      { property: "og:title", content: "Memory Center" },
      { property: "og:description", content: "Ride mission, not verdict." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const nav = useNavigate();
  const [count, setCount] = useState(0);
  const [idx, setIdx] = useState(0);
  const [hasContext, setHasContext] = useState(false);
  const [hasNotion, setHasNotion] = useState(false);
  const [sync, setSync] = useState<{ notion: boolean; gcal: boolean; gmail: boolean }>({
    notion: false,
    gcal: false,
    gmail: false,
  });
  const checkFn = useServerFn(checkSyncStatus);

  useEffect(() => {
    setCount(store.getContacts().length);
    setIdx(store.getQueueIdx());
    setHasContext(!!store.getCompanyMd());
    setHasNotion(!!store.getNotionDb());
    checkFn().then(setSync).catch(() => undefined);
  }, []);

  const remaining = Math.max(count - idx, 0);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 pt-8">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Memory Center</p>
          <h1 className="font-serif text-2xl leading-tight">Chino's dialer</h1>
        </div>
        <Link
          to="/settings"
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          Settings
        </Link>
      </header>

      <div className="mx-auto mt-10 max-w-md px-6 text-center">
        <blockquote className="font-serif text-lg leading-snug text-muted-foreground">
          "Win because the problem matters —
          <span className="text-foreground"> not so you'll finally feel worthy.</span>"
        </blockquote>
      </div>

      <div className="mt-14 flex flex-col items-center px-6">
        <button
          disabled={remaining === 0}
          onClick={() => nav({ to: "/call" })}
          className="relative flex h-56 w-56 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[0_20px_60px_-15px] shadow-primary/60 transition-transform active:scale-95 disabled:opacity-40"
        >
          <span className="font-serif text-5xl tracking-wide">GO</span>
          <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-primary/30" />
        </button>

        <p className="mt-6 text-sm text-muted-foreground">
          {count === 0
            ? "Upload a .vcf in Settings to begin."
            : remaining === 0
              ? "Queue complete. Reset in Settings."
              : `${remaining} calls in the queue`}
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-md grid-cols-3 gap-3 px-6">
        <StatusPill label="Contacts" ok={count > 0} value={count > 0 ? String(count) : "0"} />
        <StatusPill label="Context" ok={hasContext} value={hasContext ? "loaded" : "empty"} />
        <StatusPill label="Notion" ok={hasNotion} value={hasNotion ? "linked" : "off"} />
      </div>

      <div className="mx-auto mt-3 grid max-w-md grid-cols-3 gap-3 px-6">
        <StatusPill label="gCal" ok={sync.gcal} value={sync.gcal ? "linked" : "off"} />
        <StatusPill label="Gmail" ok={sync.gmail} value={sync.gmail ? "linked" : "off"} />
        <StatusPill label="API" ok={sync.notion || sync.gcal || sync.gmail} value={sync.notion ? "ok" : "—"} />
      </div>

      <div className="mx-auto mt-8 flex max-w-md gap-3 px-6 pb-10">
        <Link
          to="/queue"
          className="flex-1 rounded-2xl border border-border bg-card px-4 py-3 text-center text-sm font-medium"
        >
          Queue
        </Link>
        <Link
          to="/features"
          className="flex-1 rounded-2xl border border-border bg-card px-4 py-3 text-center text-sm font-medium"
        >
          Stats
        </Link>
        <Link
          to="/motivation"
          className="flex-1 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 px-4 py-3 text-center text-sm font-medium text-accent"
        >
          Motivation
        </Link>
      </div>
    </div>
  );
}

function StatusPill({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div
      className={`rounded-2xl border p-3 text-center ${
        ok ? "border-primary/40 bg-primary/5" : "border-border bg-card/40"
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-medium ${ok ? "text-primary" : "text-muted-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

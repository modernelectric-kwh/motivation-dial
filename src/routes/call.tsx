import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { store, type CallLog } from "@/lib/store";
import { generateCallPrep, logToNotion } from "@/lib/ai.functions";
import { fetchEnrichedTimeline, type TimelineEntry } from "@/lib/enrichment.functions";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

export const Route = createFileRoute("/call")({
  head: () => ({
    meta: [
      { title: "Memory Center · Call" },
      { name: "description", content: "PRE and POST call briefing with motivation." },
      { property: "og:title", content: "Memory Center · Call" },
      { property: "og:description", content: "Ride mission, not verdict." },
    ],
  }),
  component: CallScreen,
});

function CallScreen() {
  const router = useRouter();
  const contacts = useMemo(() => store.getContacts(), []);
  const [idx, setIdx] = useState(() => store.getQueueIdx());
  const contact = contacts[idx];

  const [pitch, setPitch] = useState("");
  const [motivation, setMotivation] = useState("");
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<CallLog["outcome"]>("connected");

  const genPrep = useServerFn(generateCallPrep);
  const sendNotion = useServerFn(logToNotion);
  const fetchTimeline = useServerFn(fetchEnrichedTimeline);

  const [remote, setRemote] = useState<TimelineEntry[]>([]);
  const [remoteErrors, setRemoteErrors] = useState<Record<string, string>>({});
  const [remoteLoading, setRemoteLoading] = useState(false);

  const history = useMemo(
    () => (contact ? store.historyFor(contact.id) : []),
    [contact, idx],
  );

  useEffect(() => {
    if (!contact) return;
    setPitch("");
    setMotivation("");
    setNotes("");
    setOutcome("connected");
    setLoading(true);
    setRemote([]);
    setRemoteErrors({});
    setRemoteLoading(true);
    fetchTimeline({
      data: {
        name: contact.name,
        email: contact.email,
        notionDb: store.getNotionDb() || undefined,
      },
    })
      .then((r) => {
        setRemote(r.entries);
        setRemoteErrors(r.errors);
      })
      .catch(() => undefined)
      .finally(() => setRemoteLoading(false));
    genPrep({
      data: {
        contactName: contact.name,
        contactOrg: contact.org,
        companyContext: store.getCompanyMd(),
        motivationSeed: store.getMotivation(),
        lastNotes: history[0]?.notes,
      },
    })
      .then((r) => {
        setPitch(r.pitch);
        setMotivation(r.motivation);
      })
      .catch((e: Error) => {
        toast.error("Prep failed", { description: e.message });
        setPitch(store.getCompanyMd().slice(0, 400) || "Open with why you called. Ask a real question.");
        setMotivation("Win because the problem matters. Not to be finally loved.");
      })
      .finally(() => setLoading(false));
  }, [contact?.id]);

  if (!contacts.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="text-muted-foreground">No contacts loaded.</p>
        <Link to="/settings" className="mt-4 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">
          Upload .vcf
        </Link>
      </div>
    );
  }
  if (!contact) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h2 className="font-serif text-2xl">Queue complete.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You ran through {contacts.length} contacts.
        </p>
        <button
          onClick={() => {
            store.setQueueIdx(0);
            setIdx(0);
          }}
          className="mt-6 rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground"
        >
          Restart queue
        </button>
        <Link to="/" className="mt-3 text-sm text-muted-foreground">
          Home
        </Link>
      </div>
    );
  }

  const advance = () => {
    const next = idx + 1;
    store.setQueueIdx(next);
    setIdx(next);
  };

  const save = async () => {
    const log: CallLog = {
      contactId: contact.id,
      contactName: contact.name,
      at: new Date().toISOString(),
      outcome,
      notes,
    };
    store.addLog(log);

    const dbUrl = store.getNotionDb();
    if (dbUrl) {
      try {
        await sendNotion({
          data: {
            databaseId: dbUrl,
            contactName: contact.name,
            outcome,
            notes,
          },
        });
        toast.success("Logged to Notion");
      } catch (e) {
        toast.error("Notion sync failed", { description: (e as Error).message });
      }
    } else {
      toast.success("Saved locally");
    }
    advance();
    router.invalidate();
  };

  const tel = contact.phone ? `tel:${contact.phone}` : undefined;
  const sms = contact.phone ? `sms:${contact.phone}` : undefined;
  const wa = contact.phone ? `https://wa.me/${contact.phone.replace(/^\+/, "")}` : undefined;

  return (
    <div className="min-h-screen pb-32">
      <Toaster theme="dark" richColors position="top-center" />
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Link to="/">← Home</Link>
          <span className="uppercase tracking-[0.2em]">
            {idx + 1} / {contacts.length}
          </span>
          <button onClick={advance} className="text-muted-foreground">
            Skip →
          </button>
        </div>
      </header>

      <div className="space-y-5 px-5 py-6">
        {/* Contact head */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Now dialing</p>
          <h1 className="mt-1 font-serif text-3xl leading-tight">{contact.name}</h1>
          {contact.org && <p className="text-sm text-muted-foreground">{contact.org}</p>}
          {contact.phone && <p className="mt-2 font-mono text-sm">{contact.phone}</p>}

          <div className="mt-4 grid grid-cols-3 gap-2">
            <ActionBtn href={tel} label="Call" variant="primary" />
            <ActionBtn href={sms} label="iMessage" />
            <ActionBtn href={wa} label="WhatsApp" external />
          </div>
        </div>

        {/* Motivation */}
        <div className="rounded-2xl border-2 border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-accent">Motivation</p>
          <p className="mt-2 font-serif text-lg leading-snug">
            {motivation || (loading ? "…" : "Ride mission, not verdict.")}
          </p>
        </div>

        {/* Pitch */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">60-sec pitch</p>
          {loading ? (
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{pitch}</p>
          )}
        </div>

        {/* Timeline */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Timeline</p>
            {remoteLoading && <span className="text-xs text-muted-foreground">syncing…</span>}
          </div>
          <Timeline localLogs={history} remote={remote} />
          {Object.keys(remoteErrors).length > 0 && (
            <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              Sync issues: {Object.entries(remoteErrors).map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </p>
          )}
        </div>

        {/* Post-call */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">After the call</p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {(["connected", "no-answer", "voicemail", "skipped"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOutcome(o)}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                  outcome === o
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="What did you talk about? Next step?"
            className="mt-3 w-full resize-none rounded-lg border border-border bg-input/40 px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary"
          />
          <button
            onClick={save}
            className="mt-3 w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground active:scale-[0.99]"
          >
            Save & next
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({
  href,
  label,
  variant,
  external,
}: {
  href?: string;
  label: string;
  variant?: "primary";
  external?: boolean;
}) {
  const base =
    "flex items-center justify-center rounded-lg py-3 text-sm font-medium transition-opacity";
  const cls =
    variant === "primary"
      ? "bg-primary text-primary-foreground"
      : "border border-border text-foreground";
  if (!href)
    return (
      <span className={`${base} ${cls} opacity-40`}>{label}</span>
    );
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={`${base} ${cls}`}
    >
      {label}
    </a>
  );
}

function Timeline({
  localLogs,
  remote,
}: {
  localLogs: CallLog[];
  remote: TimelineEntry[];
}) {
  const combined: Array<{
    key: string;
    at: string;
    source: string;
    title: string;
    snippet?: string;
    url?: string;
  }> = [
    ...localLogs.map((h, i) => ({
      key: `l-${i}`,
      at: h.at,
      source: "call",
      title: `Call · ${h.outcome}`,
      snippet: h.notes,
    })),
    ...remote.map((r, i) => ({
      key: `r-${i}`,
      at: r.at,
      source: r.source,
      title: r.title,
      snippet: r.snippet,
      url: r.url,
    })),
  ].sort((a, b) => (b.at > a.at ? 1 : -1));

  if (combined.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">First contact — no prior touchpoints.</p>;
  }

  const badgeColor = (s: string) =>
    ({
      call: "border-primary/60 text-primary",
      notion: "border-accent/60 text-accent",
      gcal: "border-chart-2/60 text-chart-2",
      gmail: "border-chart-4/60 text-chart-4",
    })[s] ?? "border-border text-muted-foreground";

  return (
    <ol className="mt-3 space-y-3">
      {combined.slice(0, 8).map((e) => (
        <li key={e.key} className="border-l-2 border-primary/40 pl-3">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${badgeColor(e.source)}`}
            >
              {e.source}
            </span>
            <p className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</p>
          </div>
          <p className="mt-1 text-sm font-medium">
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
                {e.title}
              </a>
            ) : (
              e.title
            )}
          </p>
          {e.snippet && <p className="text-xs text-muted-foreground">{e.snippet}</p>}
        </li>
      ))}
    </ol>
  );
}
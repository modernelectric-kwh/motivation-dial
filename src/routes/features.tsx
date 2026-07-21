import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { store, type CallLog } from "@/lib/store";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Memory Center · Stats" },
      { name: "description", content: "Dial stats, dispositions, and reach rate." },
      { property: "og:title", content: "Memory Center · Stats" },
      { property: "og:description", content: "How the queue is running." },
    ],
  }),
  component: Stats,
});

function Stats() {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [contactCount, setContactCount] = useState(0);
  const [dncCount, setDncCount] = useState(0);

  useEffect(() => {
    setLogs(store.getHistory());
    setContactCount(store.getContacts().length);
    setDncCount(store.getDNC().length);
  }, []);

  const total = logs.length;
  const today = logs.filter(
    (l) => new Date(l.at).toDateString() === new Date().toDateString(),
  ).length;
  const connected = logs.filter((l) => l.outcome === "connected").length;
  const vmDropped = logs.filter((l) => l.outcome === "voicemail-dropped").length;
  const reachRate = total > 0 ? Math.round((connected / total) * 100) : 0;

  const byOutcome = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.outcome] = (acc[l.outcome] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Back
        </Link>
        <h1 className="mt-1 font-serif text-2xl">Stats</h1>
        <p className="text-sm text-muted-foreground">Where the dialing is going.</p>
      </header>

      <div className="space-y-6 px-5 py-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Today" value={String(today)} />
          <StatCard label="Total calls" value={String(total)} />
          <StatCard label="Reach rate" value={`${reachRate}%`} accent />
          <StatCard label="VMs dropped" value={String(vmDropped)} />
          <StatCard label="Contacts" value={String(contactCount)} />
          <StatCard label="DNC" value={String(dncCount)} />
        </div>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-serif text-lg">Dispositions</h2>
          <ul className="mt-3 space-y-2">
            {Object.entries(byOutcome)
              .sort(([, a], [, b]) => b - a)
              .map(([k, v]) => (
                <li key={k} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </li>
              ))}
            {total === 0 && (
              <li className="text-sm text-muted-foreground">No calls logged yet.</li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-serif text-lg">Recent</h2>
          <ol className="mt-3 space-y-3">
            {logs.slice(0, 20).map((l, i) => (
              <li key={i} className="border-l-2 border-primary/40 pl-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(l.at).toLocaleString()}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider">
                    {l.outcome}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium">{l.contactName}</p>
                {l.notes && <p className="text-xs text-muted-foreground">{l.notes}</p>}
              </li>
            ))}
            {logs.length === 0 && (
              <li className="text-sm text-muted-foreground">Empty. Tap GO.</li>
            )}
          </ol>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent ? "border-accent/40 bg-accent/5" : "border-border bg-card"
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-1 font-serif text-3xl ${accent ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
}
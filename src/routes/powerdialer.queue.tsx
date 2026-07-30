// ── Powerdialer Queue Manager ──
// Browse active call queue in priority order.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/powerdialer-db";
import type { V9Contact, QueueItem, V9Tier } from "@/lib/powerdialer-types";
import { STATUS_COLORS, TIER_META } from "@/lib/powerdialer-constants";

export const Route = createFileRoute("/powerdialer/queue")({
  head: () => ({
    meta: [
      { title: "Powerdialer · Queue" },
      { name: "description", content: "Manage the V9 call queue." },
    ],
  }),
  component: QueuePage,
});

function QueuePage() {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [contacts, setContacts] = useState<V9Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTier, setFilterTier] = useState<"all" | V9Tier>("all");
  const [search, setSearch] = useState("");
  const [showClose, setShowClose] = useState(false);

  useEffect(() => {
    Promise.all([db.getAllQueueItems(), db.getAllContacts()])
      .then(([items, con]) => {
        // Filter to active V9 campaign items only
        const now = new Date().toISOString();
        const active = items.filter((qi) =>
          qi.campaignId === "v9_relationship_calls" &&
          qi.queueStatus !== "suppressed" &&
          qi.queueStatus !== "completed" &&
          qi.queueStatus !== "attempted" &&
          (!qi.nextCallAt || qi.nextCallAt <= now)
        );
        setQueueItems(active);
        setContacts(con);
      })
      .finally(() => setLoading(false));
  }, []);

  const contactMap = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );

  const rows = useMemo(() => {
    const joined = queueItems
      .map((qi) => ({ qi, contact: contactMap.get(qi.contactId) }))
      .filter((r): r is { qi: QueueItem; contact: V9Contact } => !!r.contact);

    let filtered = joined;
    if (filterTier !== "all") {
      filtered = joined.filter((r) => r.contact.tier === filterTier);
    }
    if (!showClose) {
      filtered = filtered.filter((r) => r.contact.tier !== "close");
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r) =>
        r.contact.fullName.toLowerCase().includes(q) ||
        (r.contact.company || "").toLowerCase().includes(q) ||
        r.contact.phone.includes(q) ||
        (r.contact.email || "").toLowerCase().includes(q),
      );
    }
    filtered.sort((a, b) => a.qi.priority - b.qi.priority);
    return filtered;
  }, [queueItems, contactMap, filterTier, search, showClose]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading queue…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">← Dashboard</Link>
          <Link to="/powerdialer/call" className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Start calling</Link>
        </div>
        <h1 className="mt-1 font-serif text-2xl">Queue</h1>
        <p className="text-xs text-muted-foreground">{rows.length} active · Ordered by priority</p>
      </header>

      <div className="mx-auto max-w-md px-5 py-4 space-y-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, phone, email…"
          className="w-full rounded-full border border-border bg-input/40 px-4 py-2 text-sm outline-none focus:border-primary" />

        <div className="flex flex-wrap gap-1.5">
          {(["all", "inner_circle", "warm", "close"] as const).map((t) => (
            <button key={t} onClick={() => setFilterTier(t)}
              className={`rounded-full border px-3 py-1 text-[10px] font-medium ${filterTier === t ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}>
              {t === "all" ? "All" : t.replace("_", " ")}
            </button>
          ))}
          <button onClick={() => setShowClose(!showClose)}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium ${showClose ? "border-blue-500/30 bg-blue-500/10 text-blue-400" : "border-border text-muted-foreground"}`}>
            {showClose ? "Including Close" : "Close hidden"}
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">{queueItems.length === 0 ? "No active queue items. Import V9 data first." : "No matching contacts."}</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map(({ qi, contact }) => (
              <li key={qi.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <span className="w-7 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{qi.priority + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{contact.fullName}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{contact.phone || "—"}{contact.company ? ` · ${contact.company}` : ""}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-medium uppercase ${TIER_META[contact.tier]?.badge || "border-border text-muted-foreground"}`}>{contact.tier.replace("_", "")}</span>
                <span className={`shrink-0 text-[9px] ${STATUS_COLORS[qi.queueStatus] || "text-muted-foreground"}`}>
                  {qi.queueStatus === "initiated_unconfirmed" ? "pending" : qi.queueStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-center text-[10px] text-muted-foreground">{rows.length} contacts</p>
      </div>
    </div>
  );
}

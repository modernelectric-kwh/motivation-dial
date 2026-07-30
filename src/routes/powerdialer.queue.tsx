// ── Powerdialer Queue Manager ──
// Browse, filter by tier, search, and manage queue items.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/powerdialer-db";
import type { V9Contact, QueueItem, V9Tier, QueueStatus } from "@/lib/powerdialer-types";

export const Route = createFileRoute("/powerdialer/queue")({
  head: () => ({
    meta: [
      { title: "Powerdialer · Queue" },
      { name: "description", content: "Manage the V9 call queue." },
    ],
  }),
  component: QueuePage,
});

const TIER_COLORS: Record<V9Tier, string> = {
  inner_circle: "border-amber-500/30 text-amber-400",
  close: "border-blue-500/30 text-blue-400",
  warm: "border-emerald-500/30 text-emerald-400",
  cold: "border-zinc-500/30 text-zinc-400",
};

const STATUS_COLORS: Record<QueueStatus, string> = {
  queued: "text-zinc-400",
  initiated_unconfirmed: "text-amber-400",
  outcome_required: "text-amber-400",
  attempted: "text-emerald-400",
  completed: "text-emerald-400",
  suppressed: "text-red-400",
};

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
        setQueueItems(items);
        setContacts(con);
      })
      .finally(() => setLoading(false));
  }, []);

  const contactMap = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );

  // Build ordered list: queue items sorted by priority, joined with contacts
  const rows = useMemo(() => {
    const joined = queueItems
      .map((qi) => ({ qi, contact: contactMap.get(qi.contactId) }))
      .filter((r): r is { qi: QueueItem; contact: V9Contact } => !!r.contact);

    // Filter by tier
    let filtered = joined;
    if (filterTier !== "all") {
      filtered = joined.filter((r) => r.contact.tier === filterTier);
    }

    // Optional: include Close tier in the active queue
    if (!showClose) {
      // Show inner_circle, warm, plus suppressed close contacts
      filtered = filtered.filter(
        (r) => r.contact.tier !== "close" || r.qi.queueStatus === "suppressed",
      );
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.contact.fullName.toLowerCase().includes(q) ||
          (r.contact.company || "").toLowerCase().includes(q) ||
          r.contact.phone.includes(q) ||
          (r.contact.email || "").toLowerCase().includes(q),
      );
    }

    // Sort by priority
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
          <Link to="/powerdialer" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            ← Dashboard
          </Link>
          <Link
            to="/powerdialer/call"
            className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          >
            Start calling
          </Link>
        </div>
        <h1 className="mt-1 font-serif text-2xl">Queue</h1>
        <p className="text-xs text-muted-foreground">
          {rows.length} items · Default order: Inner Circle → Warm
        </p>
      </header>

      <div className="mx-auto max-w-md px-5 py-4 space-y-3">
        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, phone, email…"
          className="w-full rounded-full border border-border bg-input/40 px-4 py-2 text-sm outline-none focus:border-primary"
        />

        {/* Tier filter */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "inner_circle", "warm", "close"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterTier(t)}
              className={`rounded-full border px-3 py-1 text-[10px] font-medium ${
                filterTier === t
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {t === "all" ? "All tiers" : t.replace("_", " ")}
            </button>
          ))}
          <button
            onClick={() => setShowClose(!showClose)}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium ${
              showClose
                ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                : "border-border text-muted-foreground"
            }`}
          >
            {showClose ? "Including Close" : "Close hidden"}
          </button>
        </div>

        {/* Queue list */}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {queueItems.length === 0
                ? "No queue items. Import V9 data first."
                : "No matching contacts."}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map(({ qi, contact }) => (
              <li
                key={qi.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                {/* Priority number */}
                <span className="w-7 shrink-0 text-center font-mono text-[10px] text-muted-foreground">
                  {qi.priority + 1}
                </span>

                {/* Contact info */}
                <Link
                  to="/powerdialer/call"
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">
                    {contact.fullName}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {contact.phone || "—"}
                    {contact.company ? ` · ${contact.company}` : ""}
                  </div>
                </Link>

                {/* Tier badge */}
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-medium uppercase ${
                    TIER_COLORS[contact.tier] || "border-border text-muted-foreground"
                  }`}
                >
                  {contact.tier.replace("_", "")}
                </span>

                {/* Status */}
                <span
                  className={`shrink-0 text-[9px] ${
                    STATUS_COLORS[qi.queueStatus] || "text-muted-foreground"
                  }`}
                >
                  {qi.queueStatus === "initiated_unconfirmed"
                    ? "pending"
                    : qi.queueStatus}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-center text-[10px] text-muted-foreground">
          {rows.length} contacts matching filters
        </p>
      </div>
    </div>
  );
}

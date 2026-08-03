// ── Powerdialer Call Log ──
// Mirrors your device call log: shows every attempt (logged + unconfirmed).
// Default filter: all calls, newest first.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/powerdialer-db";
import type { CallAttempt, V9Contact, CallOutcome } from "@/lib/powerdialer-types";
import { OUTCOME_COLORS, PERSONAL_CAMPAIGN, ENERGY_CAMPAIGN } from "@/lib/powerdialer-constants";
const CAMPAIGN_LABEL: Record<string, string> = {
  [PERSONAL_CAMPAIGN]: "Personal",
  [ENERGY_CAMPAIGN]: "Energy",
};

export const Route = createFileRoute("/powerdialer/log")({
  head: () => ({
    meta: [
      { title: "Powerdialer · Call Log" },
      { name: "description", content: "View all call attempts and outcomes." },
    ],
  }),
  component: CallLog,
});

function CallLog() {
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);
  const [contacts, setContacts] = useState<V9Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unanswered" | CallOutcome>("all");
  const [showOnlyToday, setShowOnlyToday] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([db.getAllCallAttempts(), db.getAllContacts()])
      .then(([att, con]) => {
        if (cancelled) return;
        setAttempts(att.sort((a, b) =>
          new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime(),
        ));
        setContacts(con);
      })
      .catch((err) => console.error("Failed to load call log:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const contactMap = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );

  const filtered = useMemo(() => {
    let result = attempts;
    if (showOnlyToday) {
      const today = new Date().toDateString();
      result = result.filter((a) => new Date(a.initiatedAt).toDateString() === today);
    }
    if (filter === "all") return result;
    if (filter === "unanswered") return result.filter((a) => a.outcome === null);
    return result.filter((a) => a.outcome === filter);
  }, [attempts, filter, showOnlyToday]);

  const unconfirmed = attempts.filter((a) => !a.loggedAt);
  const todayCount = attempts.filter((a) => new Date(a.initiatedAt).toDateString() === new Date().toDateString()).length;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">← Dashboard</Link>
        <h1 className="mt-1 font-serif text-2xl">Call Log</h1>
        <p className="text-xs text-muted-foreground">
          {attempts.length} calls · {unconfirmed.length} unanswered · {todayCount} today
        </p>
      </header>

      <div className="mx-auto max-w-md px-5 py-4">
        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "unanswered"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-[10px] font-medium ${filter === f ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}>
              {f === "all" ? `All (${attempts.length})` : `Unanswered (${unconfirmed.length})`}
            </button>
          ))}
          <button onClick={() => setShowOnlyToday(!showOnlyToday)}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium ${showOnlyToday ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}>
            {showOnlyToday ? "Today only" : "Today"}
          </button>
          {/* Outcome filters */}
          {(["connected", "left_voicemail", "no_answer", "texted", "calendar_sent", "intro_offered", "skip_for_now"] as const).map((o) => {
            const count = attempts.filter((a) => a.outcome === o).length;
            if (count === 0) return null;
            return (
              <button key={o} onClick={() => setFilter(filter === o ? "all" : o)}
                className={`rounded-full border px-2 py-1 text-[10px] font-medium ${filter === o ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}>
                {o.replace(/_/g, " ")} ({count})
              </button>
            );
          })}
        </div>

        {/* Log entries */}
        {filtered.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No calls matching filter.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {filtered.map((a) => {
              const c = contactMap.get(a.contactId);
              return (
                <li key={a.id} className={`rounded-2xl border p-4 ${a.outcome ? "border-border bg-card" : "border-amber-500/20 bg-amber-500/5"}`}>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{c?.fullName || a.contactId.slice(0, 8)}</p>
                        <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[9px] text-muted-foreground">
                          {CAMPAIGN_LABEL[a.campaignId] || a.campaignId}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {c?.company || ""}{c?.tier ? ` · ${c.tier.replace("_", " ")}` : ""}
                      </p>
                    </div>
                    {a.outcome ? (
                      <span className={`ml-2 shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium ${OUTCOME_COLORS[a.outcome] || "text-muted-foreground"}`}>
                        {a.outcome.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span className="ml-2 shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-400 font-medium">
                        unanswered
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span>{a.channel === "facetime_audio" ? "FaceTime" : a.channel === "manual" ? "Manual" : "Phone"}</span>
                    <span>·</span>
                    <span>{a.phoneUsed}</span>
                    <span>·</span>
                    <span>{new Date(a.initiatedAt).toLocaleString()}</span>
                  </div>
                  {a.notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{a.notes}</p>}
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > 50 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">Showing {filtered.length} entries.</p>
        )}
      </div>
    </div>
  );
}

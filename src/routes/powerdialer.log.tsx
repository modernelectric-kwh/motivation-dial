// ── Powerdialer Call Log ──
// View, filter, and review all logged call attempts.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/powerdialer-db";
import type { CallAttempt, V9Contact, CallOutcome, CommitmentStatus } from "@/lib/powerdialer-types";

export const Route = createFileRoute("/powerdialer/log")({
  head: () => ({
    meta: [
      { title: "Powerdialer · Call Log" },
      { name: "description", content: "View logged call attempts and outcomes." },
    ],
  }),
  component: CallLog,
});

const OUTCOME_COLORS: Record<string, string> = {
  connected: "text-emerald-400",
  left_voicemail: "text-blue-400",
  no_answer: "text-zinc-400",
  callback_requested: "text-amber-400",
  text_requested: "text-sky-400",
  email_requested: "text-purple-400",
  wrong_number: "text-red-400",
  do_not_call: "text-red-400",
  declined: "text-orange-400",
  duplicate: "text-red-400",
  skip_for_now: "text-zinc-500",
  intro_offered: "text-emerald-400",
  intro_made: "text-emerald-400",
};

const COMMITMENT_COLORS: Record<string, string> = {
  soft_yes: "text-amber-400",
  yes: "text-emerald-400",
  no: "text-zinc-500",
  needs_follow_up: "text-blue-400",
  not_discussed: "text-zinc-600",
};

function CallLog() {
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);
  const [contacts, setContacts] = useState<V9Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "today" | CallOutcome | "unconfirmed">("all");

  useEffect(() => {
    Promise.all([db.getAllCallAttempts(), db.getAllContacts()])
      .then(([att, con]) => {
        setAttempts(att.sort((a, b) =>
          new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime(),
        ));
        setContacts(con);
      })
      .finally(() => setLoading(false));
  }, []);

  const contactMap = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return attempts;
    if (filter === "today") {
      const today = new Date().toDateString();
      return attempts.filter((a) => new Date(a.initiatedAt).toDateString() === today);
    }
    if (filter === "unconfirmed") return attempts.filter((a) => !a.loggedAt);
    return attempts.filter((a) => a.outcome === filter);
  }, [attempts, filter]);

  const outcomes = new Map<string, number>();
  for (const a of attempts) {
    if (a.outcome) {
      outcomes.set(a.outcome, (outcomes.get(a.outcome) || 0) + 1);
    }
  }

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
        <Link to="/powerdialer" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Dashboard
        </Link>
        <h1 className="mt-1 font-serif text-2xl">Call Log</h1>
        <p className="text-xs text-muted-foreground">
          {attempts.length} attempts · {attempts.filter((a) => a.loggedAt).length} with outcomes ·{" "}
          {new Set(attempts.map((a) => a.contactId)).size} unique contacts
        </p>
      </header>

      <div className="mx-auto max-w-md px-5 py-4">
        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "today", "unconfirmed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-[10px] font-medium ${
                filter === f
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {f === "all" ? "All" : f === "today" ? "Today" : "Unconfirmed"}
            </button>
          ))}
          {[...outcomes.keys()].slice(0, 8).map((o) => (
            <button
              key={o}
              onClick={() => setFilter(o as CallOutcome)}
              className={`rounded-full border px-2 py-1 text-[10px] font-medium ${
                filter === o
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {o.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        {/* Log entries */}
        {filtered.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No matching entries.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {filtered.map((a) => {
              const c = contactMap.get(a.contactId);
              return (
                <li
                  key={a.id}
                  className="rounded-2xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c?.fullName || a.contactId.slice(0, 8)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {c?.company || ""}
                        {c?.tier ? ` · ${c.tier.replace("_", " ")}` : ""}
                      </p>
                    </div>
                    {a.outcome && (
                      <span
                        className={`ml-2 shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                          OUTCOME_COLORS[a.outcome] || "text-muted-foreground"
                        }`}
                      >
                        {a.outcome.replace(/_/g, " ")}
                      </span>
                    )}
                    {!a.loggedAt && (
                      <span className="ml-2 shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-400">
                        unconfirmed
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {a.channel === "facetime_audio" ? "FaceTime" : "Phone"}
                    </span>
                    <span>·</span>
                    <span>{a.phoneUsed}</span>
                    <span>·</span>
                    <span>
                      {new Date(a.initiatedAt).toLocaleString()}
                    </span>
                  </div>

                  {a.notes && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {a.notes}
                    </p>
                  )}

                  {a.nextStep && (
                    <p className="mt-1 text-[10px] text-blue-400">
                      Next: {a.nextStep}
                      {a.nextStepDue ? ` · due ${a.nextStepDue}` : ""}
                    </p>
                  )}

                  {a.commitmentStatus !== "not_discussed" && (
                    <p
                      className={`mt-1 text-[10px] ${
                        COMMITMENT_COLORS[a.commitmentStatus] || ""
                      }`}
                    >
                      Commitment: {a.commitmentStatus.replace(/_/g, " ")}
                      {a.commitmentDetails
                        ? ` — ${a.commitmentDetails}`
                        : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > 50 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Showing {filtered.length} entries. Use filters above to narrow.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Powerdialer Call Screen ──
// Simplified: contact card + Start FaceTime Audio + outcome pills + follow-up row.
// All manual, no autonomous dialing.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useCallback } from "react";
import { db } from "@/lib/powerdialer-db";
import type {
  V9Contact,
  QueueItem,
  CallAttempt,
  CallOutcome,
} from "@/lib/powerdialer-types";
import { TIER_META } from "@/lib/powerdialer-constants";
import { toast } from "sonner";

export const Route = createFileRoute("/powerdialer/call")({
  head: () => ({
    meta: [
      { title: "Powerdialer · Call" },
      { name: "description", content: "V9 relationship call. Manual outcome required." },
      { property: "og:title", content: "Powerdialer · Call" },
      { property: "og:description", content: "Human-operated call console." },
    ],
  }),
  component: PowerdialerCall,
});

// ── Touch summary helpers ──
function formatTouchSummary(c: V9Contact): string {
  const parts: string[] = [];
  if (c.lastInteraction) parts.push(`Last: ${c.lastInteraction}`);
  if (c.emails > 0) parts.push(`${c.emails} email${c.emails !== 1 ? "s" : ""}`);
  if (c.callsAnswered > 0) parts.push(`${c.callsAnswered} call${c.callsAnswered !== 1 ? "s" : ""}`);
  if (c.texts > 0) parts.push(`${c.texts} text${c.texts !== 1 ? "s" : ""}`);
  if (c.facetime > 0) parts.push(`${c.facetime} FaceTime`);
  if (c.whatsapp > 0) parts.push(`${c.whatsapp} WhatsApp`);
  if (c.granolaConfirmed > 0) parts.push("Granola ✓");
  if (c.meetingsValidated > 0) parts.push(`${c.meetingsValidated} meeting${c.meetingsValidated !== 1 ? "s" : ""}`);
  return parts.join(" · ") || "No prior touch history";
}

function formatFullTouch(c: V9Contact): string {
  const lines: string[] = [];
  if (c.introNodes) lines.push(`Intros: ${c.introNodes}`);
  if (c.meetingsRaw > 0) lines.push(`Meetings (raw): ${c.meetingsRaw}`);
  if (c.meetingsValidated > 0) lines.push(`Meetings (validated): ${c.meetingsValidated} (confidence: ${(c.meetingConfidence * 100).toFixed(0)}%)`);
  if (c.lastInteraction) lines.push(`Last interaction: ${c.lastInteraction}`);
  if (c.notes) lines.push(`Notes: ${c.notes}`);
  if (c.location) lines.push(`Location: ${c.location}`);
  if (c.industry) lines.push(`Industry: ${c.industry}`);
  return lines.join("\n") || "No additional touch data";
}

const OUTCOME_PILLS: Array<{ value: CallOutcome; label: string; color: string }> = [
  { value: "texted", label: "Texted", color: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  { value: "auto_vm", label: "Auto VM", color: "border-blue-500/40 bg-blue-500/10 text-blue-400" },
  { value: "manual_vm", label: "Manual VM", color: "border-indigo-500/40 bg-indigo-500/10 text-indigo-400" },
  { value: "calendar_sent", label: "🗓️ sent", color: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
];

/** Return the most recent unresolved attempt for a contact, or null. */
function getLatestUnresolvedAttempt(attempts: CallAttempt[], contactId: string): CallAttempt | null {
  return attempts
    .filter((a) => a.contactId === contactId && a.outcome === null)
    .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0] ?? null;
}

function PowerdialerCall() {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<V9Contact[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);
  const [touchExpanded, setTouchExpanded] = useState(false);
  const [called, setCalled] = useState(false);

  // Load data
  useEffect(() => {
    Promise.all([
      db.getAllContacts(),
      db.getAllQueueItems(),
      db.getAllCallAttempts(),
    ]).then(([allContacts, allItems, atts]) => {
      setAttempts(atts);

      const now = new Date().toISOString();
      const v9Items = allItems.filter(
        (qi) =>
          qi.campaignId === "v9_relationship_calls" &&
          qi.queueStatus !== "suppressed" &&
          qi.queueStatus !== "completed" &&
          qi.queueStatus !== "attempted" &&
          (!qi.nextCallAt || qi.nextCallAt <= now),
      );

      v9Items.sort((a, b) => a.priority - b.priority);

      const contactMap = new Map(allContacts.map((c) => [c.id, c]));
      const orderedContacts = v9Items
        .map((qi) => contactMap.get(qi.contactId))
        .filter(Boolean) as V9Contact[];

      setQueueItems(v9Items);
      setContacts(orderedContacts);

      // If first contact has pending outcome, show outcome state
      if (v9Items.length > 0) {
        const firstStatus = v9Items[0].queueStatus;
        setCalled(firstStatus === "initiated_unconfirmed" || firstStatus === "outcome_required");
      }

      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const contact = contacts[currentIdx];
  const queueItem = queueItems[currentIdx];

  const duplicatePhone = useMemo(
    () =>
      contact?.phone
        ? attempts.some(
            (a) =>
              a.phoneUsed === contact.phone &&
              a.contactId !== contact.id &&
              (a.outcome === "wrong_number" || a.outcome === "do_not_call" || a.outcome === "duplicate"),
          )
        : false,
    [contact?.phone, attempts],
  );

  const advance = () => {
    const next = currentIdx + 1;
    setCurrentIdx(next);
    setCalled(false);
    setTouchExpanded(false);
  };

  // ── Start FaceTime Audio ──
  const launchCall = async () => {
    if (!contact?.phone || !queueItem) return;

    const url = `facetime-audio://${contact.phone}`;

    const attempt: CallAttempt = {
      id: `att-${crypto.randomUUID()}`,
      queueItemId: queueItem.id,
      contactId: contact.id,
      campaignId: queueItem.campaignId,
      initiatedAt: new Date().toISOString(),
      loggedAt: null,
      calledBy: "Chino",
      channel: "facetime_audio",
      phoneUsed: contact.phone,
      outcome: null,
      notes: "",
      nextStep: "",
      nextStepDue: null,
      commitmentStatus: "not_discussed",
      commitmentDetails: "",
      evidenceReference: "",
    };

    const updatedQI: QueueItem = {
      ...queueItem,
      queueStatus: "initiated_unconfirmed",
      attemptCount: queueItem.attemptCount + 1,
      lastAttemptAt: attempt.initiatedAt,
    };

    try {
      await Promise.all([
        db.addCallAttempt(attempt),
        db.updateQueueItem(updatedQI),
      ]);
      setAttempts((prev) => [attempt, ...prev]);
      setQueueItems((prev) =>
        prev.map((qi) => (qi.id === queueItem.id ? updatedQI : qi)),
      );
      setCalled(true);
      toast.success("FaceTime Audio launched");
    } catch {
      toast.error("Failed to record attempt");
      return;
    }

    window.location.href = url;
  };

  // ── Save outcome pill ──
  const saveOutcome = async (outcome: CallOutcome) => {
    if (!contact || !queueItem) return;

    const latestAttempt = getLatestUnresolvedAttempt(attempts, contact.id);
    if (!latestAttempt) {
      toast.error("No unconfirmed call attempt to log");
      return;
    }

    const updatedAttempt: CallAttempt = {
      ...latestAttempt,
      loggedAt: new Date().toISOString(),
      outcome,
      notes: "",
    };

    const updatedQI: QueueItem = {
      ...queueItem,
      queueStatus: "attempted",
    };

    try {
      await Promise.all([
        db.updateCallAttempt(updatedAttempt),
        db.updateQueueItem(updatedQI),
      ]);
    } catch {
      toast.error("Failed to save outcome");
      return;
    }

    setAttempts((prev) =>
      prev.map((a) => (a.id === updatedAttempt.id ? updatedAttempt : a)),
    );
    setQueueItems((prev) =>
      prev.map((qi) => (qi.id === queueItem.id ? updatedQI : qi)),
    );

    toast.success(`Logged: ${outcome.replace("_", " ")}`);
    advance();
  };

  // ── Intro Offered → Spark Email ──
  const introOffered = async () => {
    if (!contact || !queueItem) return;

    const latestAttempt = getLatestUnresolvedAttempt(attempts, contact.id);
    const ops: Promise<unknown>[] = [];

    if (latestAttempt) {
      ops.push(db.updateCallAttempt({
        ...latestAttempt,
        loggedAt: new Date().toISOString(),
        outcome: "intro_offered",
        notes: "",
      }));
    }

    ops.push(db.updateQueueItem({
      ...queueItem,
      queueStatus: "attempted",
    }));

    try {
      await Promise.all(ops);
    } catch {
      toast.error("Failed to log intro");
      return;
    }

    if (contact.email) {
      const subject = encodeURIComponent(`${contact.fullName.split(" ")[0]} <> Chino — intro`);
      window.open(`mailto:${contact.email}?subject=${subject}`, "_blank");
    }
    toast.success("Intro Offered — email opened");
    advance();
  };

  // ── Call again later → Re-queue in 3 days ──
  const callAgainLater = async () => {
    if (!contact || !queueItem) return;

    const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const latestAttempt = getLatestUnresolvedAttempt(attempts, contact.id);
    const ops: Promise<unknown>[] = [];

    if (latestAttempt) {
      ops.push(db.updateCallAttempt({
        ...latestAttempt,
        loggedAt: new Date().toISOString(),
        outcome: "skip_for_now",
        notes: "Re-queued for 3 days",
      }));
    }

    ops.push(db.updateQueueItem({
      ...queueItem,
      queueStatus: "queued",
      nextCallAt: threeDays,
    }));

    try {
      await Promise.all(ops);
    } catch {
      toast.error("Failed to re-queue");
      return;
    }

    toast.success("Re-queued in 3 days");
    advance();
  };

  // ── Skip: random 5-21 slots down ──
  const skipDown = async () => {
    if (!queueItem || !contact) return;

    const items = await db.getAllQueueItems();
    const now = new Date().toISOString();
    const eligible = items
      .filter((qi) =>
        qi.campaignId === "v9_relationship_calls" &&
        qi.queueStatus !== "suppressed" &&
        qi.queueStatus !== "completed" &&
        qi.queueStatus !== "attempted" &&
        (!qi.nextCallAt || qi.nextCallAt <= now),
      )
      .sort((a, b) => a.priority - b.priority);

    const curIdx = eligible.findIndex((qi) => qi.id === queueItem.id);
    if (curIdx === -1 || eligible.length <= 1) return;

    const shift = Math.floor(Math.random() * 17) + 5;
    const targetIdx = Math.min(curIdx + shift, eligible.length - 1);
    if (targetIdx === curIdx) return;

    let newPriority: number;
    if (targetIdx >= eligible.length - 1) {
      newPriority = eligible[eligible.length - 1].priority + 1;
    } else {
      newPriority = (eligible[targetIdx].priority + eligible[targetIdx + 1].priority) / 2;
    }

    const latestAttempt = getLatestUnresolvedAttempt(attempts, contact.id);
    const ops: Promise<unknown>[] = [];

    if (latestAttempt) {
      ops.push(db.updateCallAttempt({
        ...latestAttempt,
        loggedAt: new Date().toISOString(),
        outcome: "skip_for_now",
        notes: `Skipped ${shift} slots down`,
      }));
    }

    ops.push(db.updateQueueItem({ ...queueItem, priority: newPriority }));

    try {
      await Promise.all(ops);
    } catch {
      toast.error("Failed to skip");
      return;
    }

    toast.success(`Skipped ${shift} slots down`);
    advance();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading queue…</p>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h2 className="font-serif text-2xl">Queue complete.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          All eligible contacts have been processed.
        </p>
        <Link
          to="/"
          className="mt-6 rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h2 className="font-serif text-2xl">All done.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You've reached the end of the queue.
        </p>
        <Link
          to="/"
          className="mt-6 rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Link to="/">← Memory Center</Link>
          <span className="uppercase tracking-[0.2em]">
            {currentIdx + 1} / {contacts.length}
          </span>
          <div className="flex gap-3">
            <button type="button" onClick={skipDown} className="text-muted-foreground" aria-label="Skip this contact">
              Skip →
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-4 px-5 py-6">
        {/* Contact card */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${
                TIER_META[contact.tier]?.badge || "border-border text-muted-foreground"
              }`}
            >
              {contact.tier.replace("_", " ")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Engagement: {contact.engagementScore.toFixed(0)}
            </span>
          </div>
          <h2 className="mt-2 font-serif text-xl leading-tight">
            {contact.fullName}
          </h2>
          {contact.company && (
            <p className="text-sm text-muted-foreground">
              {contact.title ? `${contact.title} · ` : ""}
              {contact.company}
            </p>
          )}
          {contact.phone && (
            <p className="mt-1.5 font-mono text-sm">{contact.phone}</p>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="block text-xs text-blue-400 hover:underline"
            >
              {contact.email}
            </a>
          )}
          {contact.linkedinUrl && (
            <a
              href={contact.linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-1 text-xs text-sky-400 hover:underline"
            >
              LinkedIn ↗
            </a>
          )}

          {/* Duplicate phone warning */}
          {duplicatePhone && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
              This phone was previously marked wrong-number or DNC on another contact. Review before dialing.
            </div>
          )}

          {/* Touch summary */}
          <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {formatTouchSummary(contact)}
            </p>
            <button
              type="button"
              onClick={() => setTouchExpanded(!touchExpanded)}
              className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {touchExpanded ? "Collapse" : "Expand"} touch history
            </button>
            {touchExpanded && (
              <pre className="mt-2 whitespace-pre-wrap text-[10px] text-muted-foreground leading-relaxed">
                {formatFullTouch(contact)}
              </pre>
            )}
          </div>
        </div>

        {/* Start FaceTime Audio button */}
        <button
          disabled={!contact.phone || called}
          onClick={launchCall}
          className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 font-medium text-white shadow-[0_8px_30px_-10px] shadow-blue-500/40 transition-all active:scale-[0.99] disabled:opacity-30"
        >
          <span className="text-base">Start FaceTime Audio</span>
        </button>

        {/* ROW 1: Text / VM Drop / gCal */}
        <div className="grid grid-cols-3 gap-2">
          {contact.phone && (
            <a
              href={`sms:${contact.phone}`}
              className="flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors"
            >
              Text
            </a>
          )}
          <button
            type="button"
            disabled={!contact.phone}
            onClick={() => {
              if (!contact.phone) return;
              window.location.href = `tel:${contact.phone}`;
            }}
            className="flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors disabled:opacity-30"
          >
            VM Drop
          </button>
          {contact.email && (
            <a
              href={`mailto:${contact.email}?subject=${encodeURIComponent(contact.fullName.split(" ")[0])}%20%3C%3E%20Chino%20%E2%80%94%20catch%20up`}
              className="flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors"
            >
              gCal
            </a>
          )}
        </div>

        {/* Post-call outcome panel */}
        {called && (
          <div className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 p-5 space-y-4">
            <p className="text-xs uppercase tracking-[0.2em] text-accent">
              Log outcome
            </p>

            {/* ROW 2: Outcome pills */}
            <div className="grid grid-cols-4 gap-2">
              {OUTCOME_PILLS.map((pill) => (
                <button
                  key={pill.value}
                  type="button"
                  onClick={() => saveOutcome(pill.value)}
                  className={`rounded-lg border px-2 py-2.5 text-[10px] font-medium transition-colors active:scale-95 ${pill.color}`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* ROW 3: Follow-up */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={introOffered}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-400 transition-colors active:scale-95"
              >
                Intro Offered → Email
              </button>
              <button
                type="button"
                onClick={callAgainLater}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-400 transition-colors active:scale-95"
              >
                Call again later
              </button>
            </div>
          </div>
        )}

        {/* Skip button (when not in called state) */}
        {!called && (
          <button
            type="button"
            onClick={skipDown}
            className="flex w-full items-center justify-center rounded-lg border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground hover:border-muted-foreground/30 transition-colors"
          >
            Skip (5–21 slots down)
          </button>
        )}
      </div>
    </div>
  );
}

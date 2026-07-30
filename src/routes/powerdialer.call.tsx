// ── Powerdialer Call Screen ──
// Queue-based calling: Inner Circle → Warm (Close optional).
// FaceTime Audio + Phone launch. Manual outcome logging only.
// No autonomous dialing. Each launch = initiated_unconfirmed.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { db } from "@/lib/powerdialer-db";
import type {
  V9Contact,
  QueueItem,
  CallAttempt,
  Campaign,
  CallOutcome,
  CommitmentStatus,
  CallChannel,
} from "@/lib/powerdialer-types";
import { Toaster } from "@/components/ui/sonner";
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

const OUTCOMES: Array<{ value: CallOutcome; label: string }> = [
  { value: "no_answer", label: "No Answer" },
  { value: "left_voicemail", label: "Left VM" },
  { value: "connected", label: "Connected" },
  { value: "callback_requested", label: "Callback" },
  { value: "text_requested", label: "Text OK" },
  { value: "email_requested", label: "Email OK" },
  { value: "declined", label: "Declined" },
  { value: "wrong_number", label: "Wrong #" },
  { value: "do_not_call", label: "DNC" },
  { value: "duplicate", label: "Duplicate" },
  { value: "skip_for_now", label: "Skip" },
];

const COMMITMENTS: Array<{ value: CommitmentStatus; label: string }> = [
  { value: "not_discussed", label: "Not Discussed" },
  { value: "no", label: "No" },
  { value: "soft_yes", label: "Soft Yes" },
  { value: "yes", label: "Yes" },
  { value: "needs_follow_up", label: "Needs Follow-Up" },
];

const TIER_BADGES: Record<string, string> = {
  inner_circle: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  close: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  warm: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

function PowerdialerCall() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<V9Contact[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);

  // Outcome panel state
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextStepDue, setNextStepDue] = useState("");
  const [commitmentStatus, setCommitmentStatus] =
    useState<CommitmentStatus>("not_discussed");
  const [commitmentDetails, setCommitmentDetails] = useState("");
  const [showOutcomePanel, setShowOutcomePanel] = useState(false);

  // Load data
  useEffect(() => {
    Promise.all([
      db.getAllContacts(),
      db.getAllQueueItems(),
      db.getCampaign("v9_relationship_calls"),
      db.getAllCallAttempts(),
    ]).then(([allContacts, allItems, cam, atts]) => {
      setCampaign(cam ?? null);
      setAttempts(atts);

      // Filter to active queue items for the V9 relationship campaign
      const v9Items = allItems.filter(
        (qi) =>
          qi.campaignId === "v9_relationship_calls" &&
          qi.queueStatus !== "suppressed" &&
          qi.queueStatus !== "completed",
      );

      // Sort by priority (ascending)
      v9Items.sort((a, b) => a.priority - b.priority);

      // Build contact map
      const contactMap = new Map(allContacts.map((c) => [c.id, c]));
      const orderedContacts = v9Items
        .map((qi) => contactMap.get(qi.contactId))
        .filter(Boolean) as V9Contact[];

      setQueueItems(v9Items);
      setContacts(orderedContacts);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const contact = contacts[currentIdx];
  const queueItem = queueItems[currentIdx];
  const contactAttempts = useMemo(
    () =>
      contact
        ? attempts.filter((a) => a.contactId === contact.id)
        : [],
    [contact, attempts],
  );

  const advance = () => {
    const next = currentIdx + 1;
    if (next >= contacts.length) {
      setCurrentIdx(next);
      return;
    }
    setCurrentIdx(next);
    // Reset state
    setOutcome(null);
    setNotes("");
    setNextStep("");
    setNextStepDue("");
    setCommitmentStatus("not_discussed");
    setCommitmentDetails("");
    setShowOutcomePanel(false);
  };

  // ── Launch (does NOT place call; just opens FaceTime/Phone link) ──
  const launchCall = (channel: CallChannel) => {
    if (!contact?.phone || !queueItem) return;

    const url = channel === "facetime_audio"
      ? `facetime-audio://${contact.phone}`
      : `tel:${contact.phone}`;

    // Create attempt record with initiated_unconfirmed
    const attempt: CallAttempt = {
      id: `att-${crypto.randomUUID()}`,
      queueItemId: queueItem.id,
      contactId: contact.id,
      campaignId: queueItem.campaignId,
      initiatedAt: new Date().toISOString(),
      loggedAt: null,
      calledBy: "Chino",
      channel,
      phoneUsed: contact.phone,
      outcome: null,
      notes: "",
      nextStep: "",
      nextStepDue: null,
      commitmentStatus: "not_discussed",
      commitmentDetails: "",
      evidenceReference: "",
    };

    // Update queue item status
    const updatedQI: QueueItem = {
      ...queueItem,
      queueStatus: "initiated_unconfirmed",
      attemptCount: queueItem.attemptCount + 1,
      lastAttemptAt: attempt.initiatedAt,
    };

    Promise.all([
      db.addCallAttempt(attempt),
      db.updateQueueItem(updatedQI),
    ]).then(() => {
      setAttempts((prev) => [attempt, ...prev]);
      setQueueItems((prev) =>
        prev.map((qi) => (qi.id === queueItem.id ? updatedQI : qi)),
      );
      setShowOutcomePanel(true);
      toast.success(
        channel === "facetime_audio"
          ? "FaceTime Audio launched — outcome unconfirmed"
          : "Phone launched — outcome unconfirmed",
      );
    }).catch(() => {
      toast.error("Failed to record attempt");
    });

    // Open the link
    window.location.href = url;
  };

  // ── Save outcome ──
  const saveOutcome = async () => {
    if (!outcome || !contact || !queueItem) return;

    // Enforce commitment details when soft_yes or yes
    if (
      (commitmentStatus === "soft_yes" || commitmentStatus === "yes") &&
      !commitmentDetails.trim()
    ) {
      toast.error("Commitment details are required for Yes / Soft Yes");
      return;
    }

    // Find the latest unlogged attempt for THIS contact
    const contactAttemptsSorted = attempts
      .filter((a) => a.contactId === contact.id && !a.loggedAt)
      .sort(
        (a, b) =>
          new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime(),
      );
    const latestAttempt = contactAttemptsSorted[0];
    if (!latestAttempt) {
      toast.error("No unconfirmed call attempt to log");
      return;
    }

    const updatedAttempt: CallAttempt = {
      ...latestAttempt,
      loggedAt: new Date().toISOString(),
      outcome,
      notes,
      nextStep,
      nextStepDue: nextStepDue || null,
      commitmentStatus,
      commitmentDetails,
    };

    // Determine new queue status
    let newStatus: QueueItem["queueStatus"] = "attempted";
    if (outcome === "wrong_number" || outcome === "do_not_call" || outcome === "duplicate") {
      newStatus = "suppressed";
    } else if (outcome === "skip_for_now") {
      newStatus = "queued";
    }

    const updatedQI: QueueItem = {
      ...queueItem,
      queueStatus: newStatus,
      suppressionReason:
        newStatus === "suppressed" ? outcome : queueItem.suppressionReason,
    };

    await Promise.all([
      db.updateCallAttempt(updatedAttempt),
      db.updateQueueItem(updatedQI),
    ]);

    setAttempts((prev) =>
      prev.map((a) => (a.id === updatedAttempt.id ? updatedAttempt : a)),
    );
    setQueueItems((prev) =>
      prev.map((qi) => (qi.id === queueItem.id ? updatedQI : qi)),
    );

    toast.success("Outcome logged");
    setShowOutcomePanel(false);

    if (newStatus === "suppressed") {
      advance();
    }
  };

  // ── Skip without calling ──
  const skipContact = async () => {
    if (!queueItem) return;
    const updatedQI: QueueItem = {
      ...queueItem,
      queueStatus: "suppressed",
      suppressionReason: "skip_for_now",
    };
    await db.updateQueueItem(updatedQI);
    setQueueItems((prev) =>
      prev.map((qi) => (qi.id === queueItem.id ? updatedQI : qi)),
    );
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
          to="/powerdialer"
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
          to="/powerdialer"
          className="mt-6 rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const duplicatePhone = contact.phone
    ? attempts.some(
        (a) =>
          a.phoneUsed === contact.phone &&
          a.contactId !== contact.id &&
          (a.outcome === "wrong_number" || a.outcome === "do_not_call"),
      )
    : false;

  return (
    <div className="min-h-screen pb-40">
      <Toaster theme="dark" richColors position="top-center" />

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Link to="/powerdialer">← Dashboard</Link>
          <span className="uppercase tracking-[0.2em]">
            {currentIdx + 1} / {contacts.length}
          </span>
          <div className="flex gap-3">
            <button onClick={skipContact} className="text-muted-foreground">
              Skip →
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-5 px-5 py-6">
        {/* Contact card */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${
                TIER_BADGES[contact.tier] || "border-border text-muted-foreground"
              }`}
            >
              {contact.tier.replace("_", " ")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Engagement: {contact.engagementScore.toFixed(0)}
            </span>
          </div>
          <h1 className="mt-2 font-serif text-2xl leading-tight">
            {contact.fullName}
          </h1>
          {contact.company && (
            <p className="text-sm text-muted-foreground">
              {contact.title ? `${contact.title} · ` : ""}
              {contact.company}
            </p>
          )}
          {contact.phone && (
            <p className="mt-2 font-mono text-sm">{contact.phone}</p>
          )}
          {contact.email && (
            <p className="text-xs text-muted-foreground">{contact.email}</p>
          )}

          {/* Relationship evidence */}
          <div className="mt-3 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            {contact.meetingsValidated > 0 && (
              <span className="rounded border border-border px-1.5 py-0.5">
                {contact.meetingsValidated} meetings
              </span>
            )}
            {contact.emails > 0 && (
              <span className="rounded border border-border px-1.5 py-0.5">
                {contact.emails} emails
              </span>
            )}
            {contact.texts > 0 && (
              <span className="rounded border border-border px-1.5 py-0.5">
                {contact.texts} texts
              </span>
            )}
            {contact.callsAnswered > 0 && (
              <span className="rounded border border-border px-1.5 py-0.5">
                {contact.callsAnswered} calls
              </span>
            )}
            {contact.meetingsValidated > 0 && contact.granolaConfirmed > 0 && (
              <span className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5">
                Granola ✓
              </span>
            )}
          </div>

          {/* Quarantine warning */}
          {contact.quarantined && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
              Quarantined: {contact.quarantineReason}
            </div>
          )}

          {/* Previous attempts */}
          {contactAttempts.length > 0 && (
            <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Prior attempts
              </p>
              {contactAttempts.slice(0, 3).map((a, i) => (
                <div key={i} className="mt-1 text-xs text-muted-foreground">
                  {new Date(a.initiatedAt).toLocaleString()} ·{" "}
                  {a.channel === "facetime_audio" ? "FaceTime" : "Phone"} ·{" "}
                  {a.outcome ?? "pending"}
                  {a.notes ? ` — ${a.notes.slice(0, 60)}` : ""}
                </div>
              ))}
            </div>
          )}

          {/* Duplicate phone warning */}
          {duplicatePhone && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
              This phone was previously marked wrong-number or DNC on another
              contact. Review before dialing.
            </div>
          )}
        </div>

        {/* Launch buttons */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Launch call
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              onClick={() => launchCall("facetime_audio")}
              disabled={!contact.phone}
              className="flex flex-col items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-6 text-blue-400 transition-all active:scale-95 disabled:opacity-30"
            >
              <span className="text-lg font-medium">FaceTime</span>
              <span className="mt-1 text-[10px] uppercase tracking-wider opacity-60">
                Audio
              </span>
            </button>
            <button
              onClick={() => launchCall("phone")}
              disabled={!contact.phone}
              className="flex flex-col items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-6 text-emerald-400 transition-all active:scale-95 disabled:opacity-30"
            >
              <span className="text-lg font-medium">Phone</span>
              <span className="mt-1 text-[10px] uppercase tracking-wider opacity-60">
                Cellular
              </span>
            </button>
          </div>
          {!contact.phone && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              No phone number — cannot dial
            </p>
          )}
        </div>

        {/* Context */}
        {contact.notes && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Notes
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {contact.notes}
            </p>
          </div>
        )}

        {/* Source evidence */}
        {contact.sourceFiles && (
          <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-accent">
              Source evidence
            </p>
            <p className="mt-2 text-xs leading-relaxed">{contact.sourceFiles}</p>
          </div>
        )}

        {/* QA flags */}
        {contact.qaFlags && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-400">
              QA flags
            </p>
            <p className="mt-2 text-xs leading-relaxed text-amber-400/80">
              {contact.qaFlags}
            </p>
          </div>
        )}
      </div>

      {/* Outcome panel — fixed bottom sheet */}
      {showOutcomePanel && (
        <div className="fixed inset-x-0 bottom-0 z-20 rounded-t-2xl border-t border-border bg-card p-5 shadow-[0_-10px_40px_rgba(0,0,0,0.4)] max-h-[70vh] overflow-y-auto">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />

          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Call outcome — required
          </p>

          {/* Outcome buttons */}
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                onClick={() => setOutcome(o.value)}
                className={`rounded-lg border px-2 py-2 text-[10px] font-medium transition-colors ${
                  outcome === o.value
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-muted-foreground/30"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What happened? What did they say?"
            className="mt-3 w-full resize-none rounded-lg border border-border bg-input/40 px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary"
          />

          {/* Next step */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="Next step (e.g., send intro)"
              className="rounded-lg border border-border bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary"
            />
            <input
              value={nextStepDue}
              onChange={(e) => setNextStepDue(e.target.value)}
              placeholder="Due date (optional)"
              className="rounded-lg border border-border bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary"
            />
          </div>

          {/* Commitment */}
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Commitment
            </p>
            <div className="mt-1.5 grid grid-cols-5 gap-1">
              {COMMITMENTS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCommitmentStatus(c.value)}
                  className={`rounded-lg border px-1 py-1.5 text-[9px] font-medium ${
                    commitmentStatus === c.value
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {(commitmentStatus === "soft_yes" ||
              commitmentStatus === "yes") && (
              <input
                value={commitmentDetails}
                onChange={(e) => setCommitmentDetails(e.target.value)}
                placeholder="Describe the commitment (required)"
                className="mt-1.5 w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary"
              />
            )}
          </div>

          {/* Save */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={async () => {
                setShowOutcomePanel(false);
                if (queueItem) {
                  // Find the latest unlogged attempt for this contact and mark it
                  // as deferred to prevent orphaned CallAttempt records.
                  const contactAttemptsSorted = attempts
                    .filter((a) => a.contactId === contact!.id && !a.loggedAt)
                    .sort(
                      (a, b) =>
                        new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime(),
                    );
                  const latestAttempt = contactAttemptsSorted[0];

                  const updatedQI: QueueItem = {
                    ...queueItem,
                    queueStatus: "outcome_required",
                  };

                  const ops: Promise<unknown>[] = [db.updateQueueItem(updatedQI)];

                  if (latestAttempt) {
                    const deferredAttempt: CallAttempt = {
                      ...latestAttempt,
                      loggedAt: new Date().toISOString(),
                      outcome: null,
                      notes: "Deferred — outcome pending",
                    };
                    ops.push(db.updateCallAttempt(deferredAttempt));
                    setAttempts((prev) =>
                      prev.map((a) => (a.id === deferredAttempt.id ? deferredAttempt : a)),
                    );
                  }

                  await Promise.all(ops);
                  setQueueItems((prev) =>
                    prev.map((qi) => (qi.id === queueItem.id ? updatedQI : qi)),
                  );
                }
              }}
              className="flex-1 rounded-lg border border-border py-3 text-sm text-muted-foreground"
            >
              Log later
            </button>
            <button
              onClick={saveOutcome}
              disabled={!outcome}
              className="flex-[2] rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              {outcome ? `Log "${OUTCOMES.find((o) => o.value === outcome)?.label}" & advance` : "Select outcome"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

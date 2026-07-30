// ── Memory Center · Unified Dashboard ──
// Home screen: next-contact card + Start FaceTime Audio + touch summary + quick actions.
// After-call outcomes appear inline when queue item is initiated_unconfirmed.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/powerdialer-db";
import { importV9CSV, persistImport } from "@/lib/v9-import";
import type { ImportReport, Campaign, V9Contact, QueueItem, CallAttempt, CallOutcome } from "@/lib/powerdialer-types";
import { TIER_ORDER, TIER_META } from "@/lib/powerdialer-constants";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Memory Center · Powerdialer" },
      {
        name: "description",
        content: "V9 relationship call console. Human-operated only.",
      },
      { property: "og:title", content: "Memory Center · Powerdialer" },
      { property: "og:description", content: "Inner Circle → Warm. Call lane is manual-only." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
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

function Index() {
  // ── Dashboard data ──
  const [loading, setLoading] = useState(true);
  const [autoImporting, setAutoImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({});
  const [attemptsTotal, setAttemptsTotal] = useState(0);

  // ── Next-contact data ──
  const [nextContact, setNextContact] = useState<V9Contact | null>(null);
  const [nextQueueItem, setNextQueueItem] = useState<QueueItem | null>(null);
  const [touchExpanded, setTouchExpanded] = useState(false);
  const [contactLoading, setContactLoading] = useState(true);
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);

  // ── Post-call state ──
  const [showOutcomes, setShowOutcomes] = useState(false);

  // Derived: is the next contact in a post-call state?
  const needsOutcome = nextQueueItem?.queueStatus === "initiated_unconfirmed"
    || nextQueueItem?.queueStatus === "outcome_required";

  // ── Auto-import on first visit ──
  useEffect(() => {
    if (report !== null || !loading) return;
    db.getAllQueueItems().then((items) => {
      if (items.length === 0) {
        setAutoImporting(true);
        fetch("/v9-contacts.csv")
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then(async (csv) => {
            const result = await importV9CSV(csv);
            return persistImport(result);
          })
          .then(() => loadDashboard())
          .catch((err) => {
            console.error("Auto-import failed:", err);
            setAutoImporting(false);
            setLoading(false);
          });
      }
    });
  }, [report, loading]);

  // ── Load all dashboard + next-contact data ──
  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = () =>
    Promise.all([
      db.getLatestImportReport(),
      db.getCampaign("v9_relationship_calls"),
      db.getAllQueueItems(),
      db.getAllCallAttempts(),
      db.getAllContacts(),
    ])
      .then(([rep, cam, items, atts, allContacts]) => {
        setReport(rep ?? null);
        setCampaign(cam ?? null);
        setAttemptsTotal(atts.length);
        setAttempts(atts);

        const counts: Record<string, number> = {};
        for (const item of items) {
          counts[item.queueStatus] = (counts[item.queueStatus] || 0) + 1;
        }
        setQueueCounts(counts);

        // Pick next eligible contact
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

        if (eligible.length > 0) {
          const first = eligible[0];
          const contactMap = new Map(allContacts.map((c) => [c.id, c]));
          setNextQueueItem(first);
          setNextContact(contactMap.get(first.contactId) ?? null);
          setShowOutcomes(first.queueStatus === "initiated_unconfirmed" || first.queueStatus === "outcome_required");
        } else {
          setNextQueueItem(null);
          setNextContact(null);
          setShowOutcomes(false);
        }
      })
      .catch((err) => console.error("Dashboard load failed:", err))
      .finally(() => {
        setLoading(false);
        setAutoImporting(false);
        setContactLoading(false);
      });

  // ── Refresh next contact after outcome ──
  const refreshNextContact = useCallback(() => {
    db.getAllQueueItems().then((items) => {
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

      if (eligible.length > 0) {
        const first = eligible[0];
        db.getContact(first.contactId).then((c) => {
          setNextQueueItem(first);
          setNextContact(c ?? null);
          setShowOutcomes(first.queueStatus === "initiated_unconfirmed" || first.queueStatus === "outcome_required");
        });
      } else {
        setNextQueueItem(null);
        setNextContact(null);
        setShowOutcomes(false);
      }
    });
    // Refresh dashboard counts too
    db.getAllQueueItems().then((items) => {
      const counts: Record<string, number> = {};
      for (const item of items) counts[item.queueStatus] = (counts[item.queueStatus] || 0) + 1;
      setQueueCounts(counts);
    });
    db.getAllCallAttempts().then((atts) => setAttemptsTotal(atts.length));
  }, []);

  // ── Initiate FaceTime Audio ──
  const startFaceTime = async () => {
    if (!nextContact?.phone || !nextQueueItem) return;

    const url = `facetime-audio://${nextContact.phone}`;

    const attempt: CallAttempt = {
      id: `att-${crypto.randomUUID()}`,
      queueItemId: nextQueueItem.id,
      contactId: nextContact.id,
      campaignId: nextQueueItem.campaignId,
      initiatedAt: new Date().toISOString(),
      loggedAt: null,
      calledBy: "Chino",
      channel: "facetime_audio",
      phoneUsed: nextContact.phone,
      outcome: null,
      notes: "",
      nextStep: "",
      nextStepDue: null,
      commitmentStatus: "not_discussed",
      commitmentDetails: "",
      evidenceReference: "",
    };

    const updatedQI: QueueItem = {
      ...nextQueueItem,
      queueStatus: "initiated_unconfirmed",
      attemptCount: nextQueueItem.attemptCount + 1,
      lastAttemptAt: attempt.initiatedAt,
    };

    try {
      await Promise.all([
        db.addCallAttempt(attempt),
        db.updateQueueItem(updatedQI),
      ]);
      setNextQueueItem(updatedQI);
      setShowOutcomes(true);
      toast.success("FaceTime Audio launched");
    } catch {
      toast.error("Failed to record attempt");
      return;
    }

    window.location.href = url;
  };

  // ── Save call outcome ──
  const saveOutcome = async (outcome: CallOutcome) => {
    if (!nextContact || !nextQueueItem) return;

    // Find the latest unlogged attempt for this contact
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];

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
      ...nextQueueItem,
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

    toast.success(`Logged: ${outcome.replace("_", " ")}`);
    refreshNextContact();
  };

  // ── Intro Offered → Spark Email ──
  const introOffered = async () => {
    if (!nextContact || !nextQueueItem) return;

    // Log outcome
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];

    const ops: Promise<unknown>[] = [];
    if (latestAttempt) {
      const updatedAttempt: CallAttempt = {
        ...latestAttempt,
        loggedAt: new Date().toISOString(),
        outcome: "intro_offered",
        notes: "",
      };
      ops.push(db.updateCallAttempt(updatedAttempt));
    }

    const updatedQI: QueueItem = {
      ...nextQueueItem,
      queueStatus: "attempted",
    };
    ops.push(db.updateQueueItem(updatedQI));

    try {
      await Promise.all(ops);
    } catch {
      toast.error("Failed to log intro");
      return;
    }

    // Open Spark Email (or mailto: fallback)
    if (nextContact.email) {
      const subject = encodeURIComponent(`${nextContact.fullName.split(" ")[0]} <> Chino — intro`);
      window.open(`mailto:${nextContact.email}?subject=${subject}`, "_blank");
    }
    toast.success("Intro Offered — email opened");
    refreshNextContact();
  };

  // ── Call again later → Re-queue in 3 days ──
  const callAgainLater = async () => {
    if (!nextContact || !nextQueueItem) return;

    const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    // Resolve any unlogged attempt
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];

    const ops: Promise<unknown>[] = [];
    if (latestAttempt) {
      const updatedAttempt: CallAttempt = {
        ...latestAttempt,
        loggedAt: new Date().toISOString(),
        outcome: "skip_for_now",
        notes: "Re-queued for 3 days",
      };
      ops.push(db.updateCallAttempt(updatedAttempt));
    }

    const updatedQI: QueueItem = {
      ...nextQueueItem,
      queueStatus: "queued",
      nextCallAt: threeDays,
    };
    ops.push(db.updateQueueItem(updatedQI));

    try {
      await Promise.all(ops);
    } catch {
      toast.error("Failed to re-queue");
      return;
    }

    toast.success("Re-queued in 3 days");
    refreshNextContact();
  };

  // ── Skip: random 5-21 slots down ──
  const skipDown = async () => {
    if (!nextQueueItem || !nextContact) return;

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

    const currentIdx = eligible.findIndex((qi) => qi.id === nextQueueItem.id);
    if (currentIdx === -1 || eligible.length <= 1) {
      toast.error("Cannot skip — queue too short");
      return;
    }

    const shift = Math.floor(Math.random() * 17) + 5; // 5–21
    const targetIdx = Math.min(currentIdx + shift, eligible.length - 1);

    if (targetIdx === currentIdx) {
      toast.error("Cannot skip — at end of queue");
      return;
    }

    // Compute new priority between target and target+1
    let newPriority: number;
    if (targetIdx >= eligible.length - 1) {
      newPriority = eligible[eligible.length - 1].priority + 1;
    } else {
      newPriority = (eligible[targetIdx].priority + eligible[targetIdx + 1].priority) / 2;
    }

    // Resolve any unlogged attempts too
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];

    const ops: Promise<unknown>[] = [];
    if (latestAttempt) {
      ops.push(db.updateCallAttempt({
        ...latestAttempt,
        loggedAt: new Date().toISOString(),
        outcome: "skip_for_now",
        notes: `Skipped ${shift} slots down`,
      }));
    }

    const updatedQI: QueueItem = {
      ...nextQueueItem,
      priority: newPriority,
    };
    ops.push(db.updateQueueItem(updatedQI));

    try {
      await Promise.all(ops);
    } catch {
      toast.error("Failed to skip");
      return;
    }

    toast.success(`Skipped ${shift} slots down`);
    refreshNextContact();
  };

  // ── Derived counts ──
  const queued =
    (queueCounts["queued"] || 0) +
    (queueCounts["initiated_unconfirmed"] || 0) +
    (queueCounts["outcome_required"] || 0);
  const remaining = queued;
  const suppressed = queueCounts["suppressed"] || 0;

  // ── Loading / auto-importing ──
  if (loading || autoImporting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            {autoImporting ? "Pre-loading your contacts…" : "Loading…"}
          </p>
          {autoImporting && (
            <p className="mt-2 text-xs text-muted-foreground">
              29,762 contacts loading — this takes a few seconds
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-10">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 pt-8">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Memory Center
          </p>
          <h1 className="font-serif text-2xl leading-tight">Powerdialer</h1>
        </div>
        <Link
          to="/settings"
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          Settings
        </Link>
      </header>

      {/* ── Quote ── */}
      <div className="mx-auto mt-10 max-w-md px-6 text-center">
        <blockquote className="font-serif text-lg leading-snug text-muted-foreground">
          "Win because the problem matters —
          <span className="text-foreground"> not so you'll finally feel worthy.</span>"
        </blockquote>
      </div>

      {/* ── Empty state ── */}
      {!report ? (
        <div className="mx-auto mt-14 max-w-sm px-6 text-center">
          <p className="text-sm text-muted-foreground">
            No V9 data imported yet.
          </p>
          <Link
            to="/powerdialer/import"
            className="mt-4 flex w-full items-center justify-center rounded-2xl bg-primary px-6 py-4 font-medium text-primary-foreground"
          >
            Import V9 CSV →
          </Link>
        </div>
      ) : (
        <>
          {/* ── Campaign card ── */}
          <div className="mx-auto mt-6 max-w-md px-6">
            <div className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-accent">
                {campaign?.status === "active" ? "Active Campaign" : "Campaign"}
              </p>
              <p className="mt-1 font-serif text-lg">
                {campaign?.name || "V9 Relationship Calls"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Inner Circle → Warm (Close optional filter) · Cold excluded
              </p>
            </div>
          </div>

          {/* ── Contact card + Start FaceTime Audio ── */}
          {contactLoading ? (
            <div className="mx-auto mt-8 max-w-md px-6">
              <div className="rounded-2xl border border-border bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">Loading next contact…</p>
              </div>
            </div>
          ) : nextContact && nextQueueItem ? (
            <div className="mx-auto mt-8 max-w-md px-6 space-y-4">
              {/* Contact card */}
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${
                      TIER_META[nextContact.tier]?.badge || "border-border text-muted-foreground"
                    }`}
                  >
                    {nextContact.tier.replace("_", " ")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Engagement: {nextContact.engagementScore.toFixed(0)}
                  </span>
                </div>
                <h2 className="mt-2 font-serif text-xl leading-tight">
                  {nextContact.fullName}
                </h2>
                {nextContact.company && (
                  <p className="text-sm text-muted-foreground">
                    {nextContact.title ? `${nextContact.title} · ` : ""}
                    {nextContact.company}
                  </p>
                )}
                {nextContact.phone && (
                  <p className="mt-1.5 font-mono text-sm">{nextContact.phone}</p>
                )}
                {nextContact.email && (
                  <a
                    href={`mailto:${nextContact.email}`}
                    className="block text-xs text-blue-400 hover:underline"
                  >
                    {nextContact.email}
                  </a>
                )}
                {nextContact.linkedinUrl && (
                  <a
                    href={nextContact.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block mt-1 text-xs text-sky-400 hover:underline"
                  >
                    LinkedIn ↗
                  </a>
                )}

                {/* Touch summary */}
                <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {formatTouchSummary(nextContact)}
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
                      {formatFullTouch(nextContact)}
                    </pre>
                  )}
                </div>
              </div>

              {/* Start FaceTime Audio button */}
              <button
                disabled={!nextContact.phone || showOutcomes}
                onClick={startFaceTime}
                className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 font-medium text-white shadow-[0_8px_30px_-10px] shadow-blue-500/40 transition-all active:scale-[0.99] disabled:opacity-30"
              >
                <span className="text-base">Start FaceTime Audio</span>
              </button>

              {/* Quick actions: Text / VM Drop / gCal */}
              <div className="grid grid-cols-3 gap-2">
                {nextContact.phone && (
                  <a
                    href={`sms:${nextContact.phone}`}
                    className="flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors"
                  >
                    Text
                  </a>
                )}
                <a
                  href={nextContact.phone ? `tel:${nextContact.phone}` : undefined}
                  onClick={(e) => {
                    if (!nextContact.phone) e.preventDefault();
                  }}
                  className={`flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors ${
                    !nextContact.phone ? "opacity-30 pointer-events-none" : ""
                  }`}
                >
                  VM Drop
                </a>
                {nextContact.email && (
                  <a
                    href={`mailto:${nextContact.email}?subject=${encodeURIComponent(nextContact.fullName.split(" ")[0])}%20%3C%3E%20Chino%20%E2%80%94%20catch%20up`}
                    className="flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors"
                  >
                    gCal
                  </a>
                )}
              </div>

              {/* Skip button */}
              <button
                type="button"
                onClick={skipDown}
                className="flex w-full items-center justify-center rounded-lg border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground hover:border-muted-foreground/30 transition-colors"
              >
                Skip (5–21 slots down)
              </button>

              {/* Post-call outcome pills — appear after FaceTime is initiated */}
              {showOutcomes && (
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
            </div>
          ) : (
            /* Queue empty — no eligible contacts */
            <div className="mx-auto mt-8 max-w-md px-6">
              <div className="rounded-2xl border border-border bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">Queue complete.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  All eligible contacts have been processed.
                </p>
              </div>
            </div>
          )}

          {/* ── Tier counts ── */}
          <div className="mx-auto mt-8 max-w-md px-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              V9 Import Summary
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {TIER_ORDER.map((tier) => (
                <div
                  key={tier}
                  className="rounded-xl border border-border bg-card p-3 text-center"
                >
                  <p className={`text-lg font-bold ${TIER_META[tier].color}`}>
                    {report.tierCounts[tier].toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {TIER_META[tier].label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="mx-auto mt-3 grid max-w-md grid-cols-3 gap-2 px-6">
            <StatPill label="Callable" value={report.callableCount.toLocaleString()} />
            <StatPill label="Phones" value={report.phoneCount.toLocaleString()} />
            <StatPill
              label="Dup Phones"
              value={String(report.duplicatePhones)}
              warn={report.duplicatePhones > 0}
            />
          </div>

          {/* ── Queue stats ── */}
          <div className="mx-auto mt-3 grid max-w-md grid-cols-4 gap-2 px-6">
            <StatPill label="Queued" value={String(queueCounts["queued"] || 0)} />
            <StatPill label="Called" value={String(attemptsTotal)} />
            <StatPill label="Suppressed" value={String(suppressed)} />
            <StatPill label="Completed" value={String(queueCounts["completed"] || 0)} />
          </div>

          {/* ── Warnings ── */}
          {report.quarantinedCount > 0 && (
            <div className="mx-auto mt-4 max-w-md px-6">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                <span className="font-medium text-amber-400">
                  {report.quarantinedCount} records quarantined
                </span>
                {" · "}
                {Object.entries(report.quarantinedReasons)
                  .map(([r, c]) => `${r}: ${c}`)
                  .join(" · ")}
              </div>
            </div>
          )}

          {/* ── Links ── */}
          <div className="mx-auto mt-8 grid max-w-md grid-cols-4 gap-3 px-6">
            <Link
              to="/queue"
              className="rounded-2xl border border-border bg-card px-3 py-3 text-center text-sm font-medium"
            >
              Queue
            </Link>
            <Link
              to="/powerdialer/log"
              className="rounded-2xl border border-border bg-card px-3 py-3 text-center text-sm font-medium"
            >
              Log
            </Link>
            <Link
              to="/motivation"
              className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 px-3 py-3 text-center text-sm font-medium text-accent"
            >
              Motivate
            </Link>
            <Link
              to="/powerdialer/import"
              className="rounded-2xl border border-border bg-card px-3 py-3 text-center text-sm font-medium"
            >
              Import
            </Link>
          </div>

          {/* ── Footer timestamp ── */}
          <p className="mx-auto mt-4 max-w-md px-6 text-center text-[10px] text-muted-foreground">
            Imported {new Date(report.importedAt).toLocaleString()}
            {" · "}
            {report.totalRows.toLocaleString()} rows
          </p>
        </>
      )}
    </div>
  );
}

function StatPill({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-2 text-center ${
        warn ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card"
      }`}
    >
      <p className="text-xs font-mono font-medium">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

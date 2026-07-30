// ── Memory Center · Unified Dashboard ──
// Home screen: next-contact card + Start FaceTime Audio + quick actions with inline outcomes.
// Motivation content replaces header/quote. All outcomes always visible (pre + post call).

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/powerdialer-db";
import { importV9CSV, persistImport } from "@/lib/v9-import";
import type { ImportReport, Campaign, V9Contact, QueueItem, CallAttempt, CallOutcome } from "@/lib/powerdialer-types";
import { TIER_META } from "@/lib/powerdialer-constants";
import { store } from "@/lib/store";
import { loadVoicemailBlob } from "@/lib/vm-storage";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Memory Center · Powerdialer" },
      { name: "description", content: "V9 relationship call console. Human-operated only." },
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

/** Build a Google Calendar event creation URL with Meet conferencing */
function buildGCalUrl(name: string, email: string | undefined, phone: string | undefined): string {
  // Default to tomorrow at 10am for 30 min
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const firstName = name.split(" ")[0];
  const title = encodeURIComponent(`${firstName} <> Chino — catch up`);
  const desc = encodeURIComponent(phone ? `Phone: ${phone}` : "");
  const guests = email ? `&add=${encodeURIComponent(email)}` : "";

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${desc}${guests}&confer=Meet`;
}

function Index() {
  // ── Dashboard data ──
  const [loading, setLoading] = useState(true);
  const [autoImporting, setAutoImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({});
  const [attemptsTotal, setAttemptsTotal] = useState(0);
  const [connectsTotal, setConnectsTotal] = useState(0);
  const [opportunitiesTotal, setOpportunitiesTotal] = useState(0);

  // ── Next-contact data ──
  const [nextContact, setNextContact] = useState<V9Contact | null>(null);
  const [nextQueueItem, setNextQueueItem] = useState<QueueItem | null>(null);
  const [touchExpanded, setTouchExpanded] = useState(false);
  const [contactLoading, setContactLoading] = useState(true);
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);

  // ── Post-call state ──
  const [showOutcomes, setShowOutcomes] = useState(false);

  // ── VM Drop ──
  const [vmBlob, setVmBlob] = useState<Blob | null>(null);
  const [vmPlaying, setVmPlaying] = useState(false);

  // ── Motivation ──
  const [motivationSeed, setMotivationSeed] = useState("");

  useEffect(() => {
    setMotivationSeed(store.getMotivation());
    loadVoicemailBlob().then((b) => setVmBlob(b));
  }, []);

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
        setAttempts(atts);
        setAttemptsTotal(atts.length);

        // Funnel: connects = connected + texted + calendar_sent + intro_offered + intro_made
        const connectOutcomes: CallOutcome[] = ["connected", "texted", "calendar_sent", "intro_offered", "intro_made"];
        const oppOutcomes: CallOutcome[] = ["intro_offered", "intro_made"];
        setConnectsTotal(atts.filter((a) => a.outcome && connectOutcomes.includes(a.outcome)).length);
        setOpportunitiesTotal(atts.filter((a) =>
          (a.outcome && oppOutcomes.includes(a.outcome)) ||
          a.commitmentStatus !== "not_discussed"
        ).length);

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
    Promise.all([
      db.getAllQueueItems(),
      db.getAllCallAttempts(),
    ]).then(([items, atts]) => {
      setAttempts(atts);
      setAttemptsTotal(atts.length);
      const connectOutcomes: CallOutcome[] = ["connected", "texted", "calendar_sent", "intro_offered", "intro_made"];
      const oppOutcomes: CallOutcome[] = ["intro_offered", "intro_made"];
      setConnectsTotal(atts.filter((a) => a.outcome && connectOutcomes.includes(a.outcome)).length);
      setOpportunitiesTotal(atts.filter((a) =>
        (a.outcome && oppOutcomes.includes(a.outcome)) ||
        a.commitmentStatus !== "not_discussed"
      ).length);

      const counts: Record<string, number> = {};
      for (const item of items) counts[item.queueStatus] = (counts[item.queueStatus] || 0) + 1;
      setQueueCounts(counts);

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

  // ── Play pre-recorded VM through speaker ──
  const playVoicemailDrop = async () => {
    if (!vmBlob) { toast.error("No voicemail recording in Settings"); return; }
    if (vmPlaying) return;
    const audio = new Audio(URL.createObjectURL(vmBlob));
    audio.onended = () => { setVmPlaying(false); URL.revokeObjectURL(audio.src); };
    audio.onerror = () => { setVmPlaying(false); toast.error("Playback failed"); };
    setVmPlaying(true);
    try { await audio.play(); } catch { setVmPlaying(false); toast.error("Audio blocked — tap again"); }
  };

  // ── Save call outcome (always available) ──
  const logOutcome = async (outcome: CallOutcome) => {
    if (!nextContact || !nextQueueItem) return;

    // Use the latest unlogged attempt, or create a manual one
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];

    if (latestAttempt) {
      const updatedAttempt: CallAttempt = {
        ...latestAttempt,
        loggedAt: new Date().toISOString(),
        outcome,
        notes: "",
      };
      const updatedQI: QueueItem = { ...nextQueueItem, queueStatus: "attempted" };
      try {
        await Promise.all([db.updateCallAttempt(updatedAttempt), db.updateQueueItem(updatedQI)]);
      } catch { toast.error("Failed to save outcome"); return; }
    } else {
      // No open attempt — create a manual log entry
      const manualAttempt: CallAttempt = {
        id: `att-manual-${crypto.randomUUID().slice(0, 8)}`,
        queueItemId: nextQueueItem.id,
        contactId: nextContact.id,
        campaignId: nextQueueItem.campaignId,
        initiatedAt: new Date().toISOString(),
        loggedAt: new Date().toISOString(),
        calledBy: "Chino",
        channel: "manual",
        phoneUsed: nextContact.phone || "",
        outcome,
        notes: "",
        nextStep: "",
        nextStepDue: null,
        commitmentStatus: "not_discussed",
        commitmentDetails: "",
        evidenceReference: "",
      };
      const updatedQI: QueueItem = { ...nextQueueItem, queueStatus: "attempted" };
      try {
        await Promise.all([db.addCallAttempt(manualAttempt), db.updateQueueItem(updatedQI)]);
      } catch { toast.error("Failed to save outcome"); return; }
    }

    toast.success(`Logged: ${outcome.replace("_", " ")}`);
    refreshNextContact();
  };

  // ── Intro Offered → Spark Email ──
  const introOffered = async () => {
    if (!nextContact || !nextQueueItem) return;
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];
    const ops: Promise<unknown>[] = [];
    if (latestAttempt) {
      ops.push(db.updateCallAttempt({ ...latestAttempt, loggedAt: new Date().toISOString(), outcome: "intro_offered", notes: "" }));
    }
    ops.push(db.updateQueueItem({ ...nextQueueItem, queueStatus: "attempted" }));
    try { await Promise.all(ops); } catch { toast.error("Failed to log intro"); return; }
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
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];
    const ops: Promise<unknown>[] = [];
    if (latestAttempt) {
      ops.push(db.updateCallAttempt({ ...latestAttempt, loggedAt: new Date().toISOString(), outcome: "skip_for_now", notes: "Re-queued for 3 days" }));
    }
    ops.push(db.updateQueueItem({ ...nextQueueItem, queueStatus: "queued", nextCallAt: threeDays }));
    try { await Promise.all(ops); } catch { toast.error("Failed to re-queue"); return; }
    toast.success("Re-queued in 3 days");
    refreshNextContact();
  };

  // ── Priority reorder helper ──
  const reorderInQueue = async (qi: QueueItem, targetPriority: number, reason: string) => {
    const latestAttempt = attempts
      .filter((a) => a.contactId === qi.contactId && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];
    const ops: Promise<unknown>[] = [];
    if (latestAttempt) {
      ops.push(db.updateCallAttempt({ ...latestAttempt, loggedAt: new Date().toISOString(), outcome: "skip_for_now", notes: reason }));
    }
    ops.push(db.updateQueueItem({ ...qi, priority: targetPriority }));
    try { await Promise.all(ops); } catch { toast.error("Failed to reorder"); return false; }
    return true;
  };

  // ── Soft Skip: random 5-21 slots down ──
  const softSkip = async () => {
    if (!nextQueueItem || !nextContact) return;
    const items = await db.getAllQueueItems();
    const now = new Date().toISOString();
    const eligible = items
      .filter((qi) => qi.campaignId === "v9_relationship_calls" && qi.queueStatus !== "suppressed" && qi.queueStatus !== "completed" && qi.queueStatus !== "attempted" && (!qi.nextCallAt || qi.nextCallAt <= now))
      .sort((a, b) => a.priority - b.priority);
    const curIdx = eligible.findIndex((qi) => qi.id === nextQueueItem.id);
    if (curIdx === -1 || eligible.length <= 1) return;
    const shift = Math.floor(Math.random() * 17) + 5;
    const targetIdx = Math.min(curIdx + shift, eligible.length - 1);
    if (targetIdx === curIdx) return;
    const newPriority = targetIdx >= eligible.length - 1
      ? eligible[eligible.length - 1].priority + 1
      : (eligible[targetIdx].priority + eligible[targetIdx + 1].priority) / 2;
    await reorderInQueue(nextQueueItem, newPriority, `Skipped ${shift} slots down`);
    toast.success(`Skipped ${shift} slots down`);
    refreshNextContact();
  };

  // ── Warm Skip: to top of warm list ──
  const warmSkip = async () => {
    if (!nextQueueItem || !nextContact) return;
    const items = await db.getAllQueueItems();
    const now = new Date().toISOString();
    const filtered = items
      .filter((qi) => qi.campaignId === "v9_relationship_calls" && qi.queueStatus !== "suppressed" && qi.queueStatus !== "completed" && qi.queueStatus !== "attempted" && (!qi.nextCallAt || qi.nextCallAt <= now))
      .sort((a, b) => a.priority - b.priority);
    // Find highest inner_circle priority and first warm priority
    let warmPriority = -1;
    for (const qi of filtered) {
      const c = nextContact; // we need tier from contacts — but we have filtered items
      // Use a simple heuristic: find the first non-inner_circle item's priority
    }
    // Actually, we can't easily get tier without contacts. Let me use priority gap approach:
    // Sort eligible, find the last inner_circle, insert after it (or at position 0 if no inner_circle)
    // But we need to know tiers... Let me load contacts
    const allContacts = await db.getAllContacts();
    const contactMap = new Map(allContacts.map((c) => [c.id, c]));
    const withTier = filtered.map((qi) => ({ qi, tier: contactMap.get(qi.contactId)?.tier }));
    // Find the last inner_circle item
    const lastIC = withTier.filter((x) => x.tier === "inner_circle").pop();
    if (lastIC) {
      // Insert right after last inner_circle
      const newPriority = lastIC.qi.priority + 0.5;
      await reorderInQueue(nextQueueItem, newPriority, "Warm skip — top of warm");
    } else {
      // No inner_circle — insert at top
      const topPriority = filtered[0]?.priority ?? 0;
      await reorderInQueue(nextQueueItem, topPriority - 1, "Warm skip — top of warm (no IC)");
    }
    toast.success("Moved to top of warm list");
    refreshNextContact();
  };

  // ── Hard Skip: suppress from queue ──
  const hardSkip = async () => {
    if (!nextQueueItem || !nextContact) return;
    const ops: Promise<unknown>[] = [];
    const latestAttempt = attempts
      .filter((a) => a.contactId === nextContact.id && a.outcome === null)
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())[0];
    if (latestAttempt) {
      ops.push(db.updateCallAttempt({ ...latestAttempt, loggedAt: new Date().toISOString(), outcome: "skip_for_now", notes: "Hard skip — removed from queue" }));
    }
    ops.push(db.updateQueueItem({ ...nextQueueItem, queueStatus: "suppressed" }));
    try { await Promise.all(ops); } catch { toast.error("Failed to suppress"); return; }
    toast.success("Removed from queue");
    refreshNextContact();
  };

  // ── Running numbers ──
  const remaining = (queueCounts["queued"] || 0) + (queueCounts["initiated_unconfirmed"] || 0) + (queueCounts["outcome_required"] || 0);

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
      {/* ── Motivation ── */}
      <div className="mx-auto mt-10 max-w-md px-6">
        <div className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 p-5">
          <blockquote className="font-serif text-lg leading-snug text-muted-foreground">
            "Win because the problem matters —
            <span className="text-foreground"> not so you'll finally feel worthy.</span>"
          </blockquote>
          <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Healthy mode
          </p>
          {motivationSeed && (
            <p className="mt-3 text-xs text-muted-foreground/70 line-clamp-3">{motivationSeed.slice(0, 200)}</p>
          )}
        </div>
      </div>

      {/* ── Funnel ── */}
      <div className="mx-auto mt-4 max-w-md px-6">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border bg-card p-2 text-center">
            <p className="font-mono text-lg font-bold">{attemptsTotal}</p>
            <p className="text-[10px] uppercase text-muted-foreground">Dials</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-2 text-center">
            <p className="font-mono text-lg font-bold">{connectsTotal}</p>
            <p className="text-[10px] uppercase text-muted-foreground">Connects</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-2 text-center">
            <p className="font-mono text-lg font-bold">{opportunitiesTotal}</p>
            <p className="text-[10px] uppercase text-muted-foreground">Opps</p>
          </div>
        </div>
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
          {/* ── Contact card + Start FaceTime Audio ── */}
          {contactLoading ? (
            <div className="mx-auto mt-6 max-w-md px-6">
              <div className="rounded-2xl border border-border bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">Loading next contact…</p>
              </div>
            </div>
          ) : nextContact && nextQueueItem ? (
            <div className="mx-auto mt-6 max-w-md px-6 space-y-4">
              {/* Contact card */}
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${TIER_META[nextContact.tier]?.badge || "border-border text-muted-foreground"}`}>
                    {nextContact.tier.replace("_", " ")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Engagement: {nextContact.engagementScore.toFixed(0)}
                  </span>
                </div>
                <h2 className="mt-2 font-serif text-xl leading-tight">{nextContact.fullName}</h2>
                {nextContact.company && (
                  <p className="text-sm text-muted-foreground">
                    {nextContact.title ? `${nextContact.title} · ` : ""}{nextContact.company}
                  </p>
                )}
                {nextContact.phone && <p className="mt-1.5 font-mono text-sm">{nextContact.phone}</p>}
                {nextContact.email && (
                  <a href={`mailto:${nextContact.email}`} className="block text-xs text-blue-400 hover:underline">{nextContact.email}</a>
                )}
                {nextContact.linkedinUrl && (
                  <a href={nextContact.linkedinUrl} target="_blank" rel="noreferrer" className="inline-block mt-1 text-xs text-sky-400 hover:underline">LinkedIn ↗</a>
                )}

                {/* Touch summary */}
                <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">{formatTouchSummary(nextContact)}</p>
                  <button type="button" onClick={() => setTouchExpanded(!touchExpanded)} className="mt-1 text-[10px] text-muted-foreground hover:text-foreground">
                    {touchExpanded ? "Collapse" : "Expand"} touch history
                  </button>
                  {touchExpanded && (
                    <pre className="mt-2 whitespace-pre-wrap text-[10px] text-muted-foreground leading-relaxed">{formatFullTouch(nextContact)}</pre>
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

              {/* ROW 1: Text → Email → gCal */}
              <div className="grid grid-cols-3 gap-2">
                {/* Text column */}
                <div className="space-y-1.5">
                  {nextContact.phone ? (
                    <a href={`sms:${nextContact.phone}`} className="flex items-center justify-center rounded-lg border border-border bg-card px-2 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors">Text</a>
                  ) : (
                    <span className="flex items-center justify-center rounded-lg border border-border bg-card px-2 py-2.5 text-xs text-muted-foreground/30">Text</span>
                  )}
                  <button type="button" onClick={() => logOutcome("texted")}
                    className="w-full rounded-lg border border-sky-500/40 bg-sky-500/10 px-1.5 py-1.5 text-[10px] font-medium text-sky-400 transition-colors active:scale-95">
                    I texted
                  </button>
                </div>

                {/* Email column */}
                <div className="space-y-1.5">
                  {nextContact.email ? (
                    <a href={`mailto:${nextContact.email}?subject=${encodeURIComponent(nextContact.fullName.split(" ")[0])}%20%3C%3E%20Chino%20%E2%80%94%20catch%20up`} className="flex items-center justify-center rounded-lg border border-border bg-card px-2 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors">Email</a>
                  ) : (
                    <span className="flex items-center justify-center rounded-lg border border-border bg-card px-2 py-2.5 text-xs text-muted-foreground/30">Email</span>
                  )}
                  <button type="button" onClick={() => logOutcome("texted")}
                    className="w-full rounded-lg border border-sky-500/40 bg-sky-500/10 px-1.5 py-1.5 text-[10px] font-medium text-sky-400 transition-colors active:scale-95">
                    I emailed
                  </button>
                </div>

                {/* gCal column — always visible even without email */}
                <div className="space-y-1.5">
                  <a
                    href={buildGCalUrl(nextContact.fullName, nextContact.email || undefined, nextContact.phone || undefined)}
                    target="_blank" rel="noreferrer"
                    className="flex items-center justify-center rounded-lg border border-border bg-card px-2 py-2.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/30 transition-colors"
                  >gCal</a>
                  <button type="button" onClick={() => logOutcome("calendar_sent")}
                    className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-1.5 py-1.5 text-[10px] font-medium text-amber-400 transition-colors active:scale-95">
                    🗓️ sent
                  </button>
                </div>
              </div>

              {/* ROW 2: VM Drop (split: Auto | Manual) */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <button
                    type="button" disabled={!vmBlob || vmPlaying}
                    onClick={playVoicemailDrop}
                    className={`flex items-center justify-center rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                      !vmBlob ? "border-border bg-card text-muted-foreground/30"
                      : vmPlaying ? "border-blue-500/40 bg-blue-500/10 text-blue-400 animate-pulse"
                      : "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:border-blue-500/50"
                    }`}
                  >
                    {vmPlaying ? "Playing…" : "Auto VM Drop"}
                  </button>
                  <button type="button" onClick={() => logOutcome("auto_vm")}
                    className="w-full rounded-lg border border-blue-500/40 bg-blue-500/10 px-1.5 py-1.5 text-[10px] font-medium text-blue-400 transition-colors active:scale-95">
                    Auto VM
                  </button>
                </div>
                <div className="space-y-1.5">
                  {nextContact.phone ? (
                    <a href={`tel:${nextContact.phone}`} className="flex items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2 py-2.5 text-xs font-medium text-indigo-400 hover:border-indigo-500/50 transition-colors">Manual VM Drop</a>
                  ) : (
                    <span className="flex items-center justify-center rounded-lg border border-border bg-card px-2 py-2.5 text-xs text-muted-foreground/30">Manual VM Drop</span>
                  )}
                  <button type="button" onClick={() => logOutcome("manual_vm")}
                    className="w-full rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-1.5 text-[10px] font-medium text-indigo-400 transition-colors active:scale-95">
                    Manual VM
                  </button>
                </div>
              </div>

              {/* Post-call follow-up: Intro Offered + Call again later */}
              {showOutcomes && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={introOffered}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-400 transition-colors active:scale-95">
                    Intro Offered → Email
                  </button>
                  <button type="button" onClick={callAgainLater}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-400 transition-colors active:scale-95">
                    Call again later
                  </button>
                </div>
              )}

              {/* Skip row */}
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={softSkip}
                  className="flex items-center justify-center rounded-lg border border-border bg-card px-2 py-2 text-[10px] text-muted-foreground hover:border-muted-foreground/30 transition-colors">
                  Skip (5–21 ↓)
                </button>
                <button type="button" onClick={warmSkip}
                  className="flex items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-2 text-[10px] text-amber-400 hover:border-amber-500/40 transition-colors">
                  Warm Skip
                </button>
                <button type="button" onClick={hardSkip}
                  className="flex items-center justify-center rounded-lg border border-red-500/30 bg-red-500/5 px-2 py-2 text-[10px] text-red-400 hover:border-red-500/40 transition-colors">
                  Hard Skip
                </button>
              </div>
            </div>
          ) : (
            /* Queue empty */
            <div className="mx-auto mt-8 max-w-md px-6">
              <div className="rounded-2xl border border-border bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">Queue complete.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  All eligible contacts have been processed.
                </p>
              </div>
            </div>
          )}

          {/* ── Queue stats ── */}
          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-2 px-6">
            <StatPill label="Queued" value={String(remaining)} />
            <StatPill label="Called" value={String(attemptsTotal)} />
            <StatPill label="Completed" value={String(queueCounts["completed"] || 0)} />
          </div>

          {/* ── Links ── */}
          <div className="mx-auto mt-4 grid max-w-md grid-cols-3 gap-3 px-6">
            <Link to="/powerdialer/queue" className="rounded-2xl border border-border bg-card px-3 py-3 text-center text-sm font-medium">Queue</Link>
            <Link to="/powerdialer/log" className="rounded-2xl border border-border bg-card px-3 py-3 text-center text-sm font-medium">Log</Link>
            <Link to="/powerdialer/import" className="rounded-2xl border border-border bg-card px-3 py-3 text-center text-sm font-medium">Import</Link>
          </div>

          {/* ── Footer ── */}
          <p className="mx-auto mt-4 max-w-md px-6 text-center text-[10px] text-muted-foreground">
            Imported {new Date(report.importedAt).toLocaleString()} · {report.totalRows.toLocaleString()} rows
          </p>
        </>
      )}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-2 text-center">
      <p className="text-xs font-mono font-medium">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

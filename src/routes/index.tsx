// ── Memory Center · Unified Dashboard ──
// Merged: Memory Center branding + V9 Powerdialer stats and call queue.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { db } from "@/lib/powerdialer-db";
import { importV9CSV, persistImport } from "@/lib/v9-import";
import type { ImportReport, Campaign } from "@/lib/powerdialer-types";
import { TIER_ORDER, TIER_META } from "@/lib/powerdialer-constants";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Memory Center · Powerdialer" },
      {
        name: "description",
        content:
          "V9 relationship call console. Human-operated only.",
      },
      { property: "og:title", content: "Memory Center · Powerdialer" },
      { property: "og:description", content: "Inner Circle → Warm. Call lane is manual-only." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

function Index() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [autoImporting, setAutoImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({});
  const [attemptsTotal, setAttemptsTotal] = useState(0);

  // Auto-import pre-loaded V9 contacts CSV on first visit
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

  // Load dashboard data from IndexedDB
  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = () =>
    Promise.all([
      db.getLatestImportReport(),
      db.getCampaign("v9_relationship_calls"),
      db.getAllQueueItems(),
      db.getAllCallAttempts(),
    ])
      .then(([rep, cam, items, attempts]) => {
        setReport(rep ?? null);
        setCampaign(cam ?? null);
        setAttemptsTotal(attempts.length);
        const counts: Record<string, number> = {};
        for (const item of items) {
          counts[item.queueStatus] = (counts[item.queueStatus] || 0) + 1;
        }
        setQueueCounts(counts);
      })
      .catch((err) => console.error("Dashboard load failed:", err))
      .finally(() => {
        setLoading(false);
        setAutoImporting(false);
      });

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

          {/* ── CALL button ── */}
          <div className="mt-8 flex flex-col items-center px-6">
            <button
              disabled={remaining === 0}
              onClick={() => nav({ to: "/powerdialer/call" })}
              className="relative flex h-56 w-56 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-emerald-600 text-white shadow-[0_20px_60px_-15px] shadow-amber-500/40 transition-transform active:scale-95 disabled:opacity-30"
            >
              <span className="font-serif text-5xl tracking-wide">CALL</span>
            </button>
            <p className="mt-6 text-sm text-muted-foreground">
              {remaining === 0
                ? "Queue complete. Check the log."
                : `${remaining} eligible in queue`}
            </p>
          </div>

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

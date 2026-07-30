// ── Powerdialer Landing / Dashboard ──
// Shows tier counts, import status, active campaign, and quick-start.

import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { db } from "@/lib/powerdialer-db";
import { importV9CSV, persistImport } from "@/lib/v9-import";
import type { ImportReport, Campaign } from "@/lib/powerdialer-types";
import { TIER_ORDER, TIER_META } from "@/lib/powerdialer-constants";

export const Route = createFileRoute("/powerdialer")({
  head: () => ({
    meta: [
      { title: "Modern Electric · Powerdialer" },
      { name: "description", content: "V9 relationship call console. Human-operated only." },
      { property: "og:title", content: "ME · Powerdialer" },
      { property: "og:description", content: "Inner Circle → Warm. Call lane is manual-only." },
    ],
  }),
  component: PowerdialerHome,
});

function PowerdialerHome() {
  const isIndex = useRouterState({ select: (s) => s.location.pathname === "/powerdialer" });
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({});
  const [attemptsTotal, setAttemptsTotal] = useState(0);
  const [autoImporting, setAutoImporting] = useState(false);

  // Auto-import pre-loaded contacts CSV on first visit
  useEffect(() => {
    if (report !== null || loading) return;
    // Only run if DB is truly empty (no report, no queue items)
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
          .then(() => {
            // Reload after import
            return Promise.all([
              db.getLatestImportReport(),
              db.getCampaign("v9_relationship_calls"),
              db.getAllQueueItems(),
              db.getAllCallAttempts(),
            ]);
          })
          .then(([rep, cam, items, attempts]) => {
            setReport(rep ?? null);
            setCampaign(cam ?? null);
            setAttemptsTotal(attempts.length);
            const counts: Record<string, number> = {};
            for (const item of items) {
              counts[item.queueStatus] = (counts[item.queueStatus] || 0) + 1;
            }
            setQueueCounts(counts);
            setAutoImporting(false);
          })
          .catch((err) => {
            console.error("Auto-import failed:", err);
            setAutoImporting(false);
          });
      }
    });
  }, [report, loading]);

  useEffect(() => {
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
        // Count queue items by status
        const counts: Record<string, number> = {};
        for (const item of items) {
          counts[item.queueStatus] = (counts[item.queueStatus] || 0) + 1;
        }
        // Tier counts from queue
        setQueueCounts(counts);
      })
      .catch((err) => console.error("Powerdialer load failed:", err))
      .finally(() => setLoading(false));
  }, []);

  if (!isIndex) return <Outlet />;

  if (loading || autoImporting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            {autoImporting ? "Pre-loading your contacts…" : "Loading Powerdialer…"}
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

  if (!report) {
    return (
      <div className="min-h-screen px-5 py-10">
        <header className="mb-8 text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Modern Electric
          </p>
          <h1 className="mt-1 font-serif text-3xl">Powerdialer</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No V9 data imported yet.
          </p>
        </header>
        <div className="mx-auto max-w-sm space-y-4">
          <Link
            to="/powerdialer/import"
            className="flex w-full items-center justify-center rounded-2xl bg-primary px-6 py-4 font-medium text-primary-foreground"
          >
            Import V9 CSV →
          </Link>
          <p className="text-center text-xs text-muted-foreground">
            Upload the canonical V9 Rolodex CSV to begin. The existing HTML/VCF
            assets remain unchanged.
          </p>
        </div>
        <div className="mt-8">
          <Link to="/" className="block text-center text-xs text-muted-foreground">
            ← Memory Center
          </Link>
        </div>
      </div>
    );
  }

  const queued =
    (queueCounts["queued"] || 0) +
    (queueCounts["initiated_unconfirmed"] || 0) +
    (queueCounts["outcome_required"] || 0) +
    (queueCounts["attempted"] || 0);
  const remaining = queued;
  const suppressed = queueCounts["suppressed"] || 0;

  return (
    <div className="min-h-screen pb-20">
      <header className="border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            ← Memory Center
          </Link>
          <div className="flex gap-3">
            <Link
              to="/powerdialer/import"
              className="text-xs text-muted-foreground"
            >
              Import
            </Link>
            <Link
              to="/powerdialer/export"
              className="text-xs text-muted-foreground"
            >
              Export
            </Link>
            <Link
              to="/powerdialer/log"
              className="text-xs text-muted-foreground"
            >
              Log
            </Link>
          </div>
        </div>
        <h1 className="mt-2 font-serif text-2xl">Powerdialer</h1>
        <p className="text-xs text-muted-foreground">
          V9 Relationship Calls · Human-operated only · No calls placed by agents
        </p>
      </header>

      <div className="mx-auto max-w-md px-5">
        {/* Campaign status */}
        <div className="mt-6 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-accent">
            {campaign?.status === "active" ? "Active Campaign" : "Campaign"}
          </p>
          <p className="mt-1 font-serif text-lg">
            {campaign?.name || "V9 Relationship Calls"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Default order: Inner Circle → Warm
            <br />
            Close available as optional filter
            <br />
            Cold excluded from call queue
          </p>
        </div>

        {/* GO button */}
        <div className="mt-8 flex flex-col items-center">
          <button
            disabled={remaining === 0}
            onClick={() => nav({ to: "/powerdialer/call" })}
            className="relative flex h-48 w-48 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-emerald-600 text-white shadow-[0_20px_60px_-15px] shadow-amber-500/40 transition-transform active:scale-95 disabled:opacity-30"
          >
            <span className="font-serif text-4xl tracking-wide">CALL</span>
          </button>
          <p className="mt-4 text-sm text-muted-foreground">
            {remaining === 0
              ? "Queue complete. Check the log."
              : `${remaining} eligible in queue`}
          </p>
        </div>

        {/* Tier counts */}
        <div className="mt-8">
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

        {/* Stats row */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatPill
            label="Callable"
            value={report.callableCount.toLocaleString()}
          />
          <StatPill
            label="Phones"
            value={report.phoneCount.toLocaleString()}
          />
          <StatPill
            label="Dup Phones"
            value={String(report.duplicatePhones)}
            warn={report.duplicatePhones > 0}
          />
        </div>

        {/* Queue stats */}
        <div className="mt-3 grid grid-cols-4 gap-2">
          <StatPill label="Queued" value={String(queueCounts["queued"] || 0)} />
          <StatPill
            label="Attempted"
            value={String(attemptsTotal)}
          />
          <StatPill
            label="Suppressed"
            value={String(suppressed)}
          />
          <StatPill
            label="Completed"
            value={String(queueCounts["completed"] || 0)}
          />
        </div>

        {/* Warnings */}
        {report.quarantinedCount > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <span className="font-medium text-amber-400">
              {report.quarantinedCount} records quarantined
            </span>
            {" · "}
            {Object.entries(report.quarantinedReasons)
              .map(([r, c]) => `${r}: ${c}`)
              .join(" · ")}
          </div>
        )}

        {report.duplicatePhones > 0 && (
          <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <span className="font-medium text-amber-400">
              {report.duplicatePhones} duplicate phone entries
            </span>
            {" across "}
            {report.duplicatePhoneGroups.length} phone numbers. Duplicate-phone
            contacts are in queue but will not be dialed twice. Review in Queue.
          </div>
        )}

        {/* Links */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          <Link
            to="/powerdialer/queue"
            className="rounded-2xl border border-border bg-card px-4 py-3 text-center text-sm font-medium"
          >
            Queue
          </Link>
          <Link
            to="/powerdialer/log"
            className="rounded-2xl border border-border bg-card px-4 py-3 text-center text-sm font-medium"
          >
            Call Log
          </Link>
          <Link
            to="/powerdialer/import"
            className="rounded-2xl border border-border bg-card px-4 py-3 text-center text-sm font-medium"
          >
            Re-import
          </Link>
        </div>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          Imported {new Date(report.importedAt).toLocaleString()}
          {" · "}
          {report.totalRows.toLocaleString()} rows processed
        </p>
      </div>
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
        warn
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border bg-card"
      }`}
    >
      <p className="text-xs font-mono font-medium">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

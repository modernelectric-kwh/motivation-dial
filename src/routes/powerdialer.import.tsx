// ── Powerdialer Import ──
// Upload the canonical V9 CSV, run QA, and persist.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { importV9CSV, persistImport, type ImportResult } from "@/lib/v9-import";
import { db } from "@/lib/powerdialer-db";
import type { ImportReport } from "@/lib/powerdialer-types";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/powerdialer/import")({
  head: () => ({
    meta: [
      { title: "Powerdialer · Import V9" },
      { name: "description", content: "Import the canonical V9 Rolodex CSV." },
    ],
  }),
  component: ImportPage,
});

function ImportPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState<"idle" | "parsing" | "importing" | "done" | "error">("idle");
  const [existingReport, setExistingReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    db.getLatestImportReport().then(setExistingReport).catch(() => {});
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("parsing");
    setProgress(`Reading ${(file.size / 1024 / 1024).toFixed(1)} MB…`);
    setError("");

    try {
      const text = await file.text();
      setProgress("Parsing CSV rows…");

      // Use setTimeout to yield to UI between phases
      await new Promise((r) => setTimeout(r, 50));

      const importResult = await importV9CSV(text);
      setResult(importResult);

      setStatus("importing");
      setProgress("Writing to IndexedDB…");
      await new Promise((r) => setTimeout(r, 50));

      await persistImport(importResult);

      setStatus("done");
      setProgress("");
      toast.success(
        `${importResult.report.totalRows.toLocaleString()} contacts imported`,
      );
    } catch (err) {
      setStatus("error");
      setError((err as Error).message || "Unknown error");
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Clear all Powerdialer data? This cannot be undone.")) return;
    await db.clearAllData();
    setExistingReport(null);
    setResult(null);
    setStatus("idle");
    toast.success("All Powerdialer data cleared");
  };

  return (
    <div className="min-h-screen pb-20">
      <Toaster theme="dark" richColors position="top-center" />

      <header className="border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <Link to="/powerdialer" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Dashboard
        </Link>
        <h1 className="mt-1 font-serif text-2xl">Import V9 Rolodex</h1>
        <p className="text-xs text-muted-foreground">
          Upload the canonical V9 CSV (29,762 rows). Existing HTML/VCF assets remain unchanged.
        </p>
      </header>

      <div className="mx-auto max-w-md px-5 py-8">
        {/* Existing import info */}
        {existingReport && status === "idle" && (
          <div className="mb-6 rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Existing import
            </p>
            <p className="mt-2 text-sm">
              {existingReport.totalRows.toLocaleString()} contacts imported on{" "}
              {new Date(existingReport.importedAt).toLocaleString()}
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center">
              {(["inner_circle", "close", "warm", "cold"] as const).map((t) => (
                <div key={t} className="rounded-lg border border-border p-2">
                  <p className="text-lg font-bold">{existingReport.tierCounts[t].toLocaleString()}</p>
                  <p className="text-[9px] uppercase text-muted-foreground">
                    {t.replace("_", " ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File input */}
        {status !== "done" && (
          <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFile}
              disabled={status === "parsing" || status === "importing"}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={status === "parsing" || status === "importing"}
              className="rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground disabled:opacity-40"
            >
              {status === "parsing" || status === "importing"
                ? `${progress || "Working…"}`
                : "Select V9 CSV"}
            </button>
            <p className="mt-3 text-xs text-muted-foreground">
              Expected: MODERN_ELECTRIC_ROLODEX_V9_CANONICAL.csv
              <br />
              Columns: full_name, email, phone, company, title, tier, engagement_score, meetings_validated, etc.
            </p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
            <p className="text-sm font-medium text-red-400">Import failed</p>
            <p className="mt-1 text-xs text-red-400/80">{error}</p>
            <button
              onClick={() => { setStatus("idle"); setError(""); }}
              className="mt-3 text-xs text-red-400 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {result && status === "done" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <p className="text-lg font-medium text-emerald-400">Import complete ✓</p>
              <p className="mt-1 text-sm text-emerald-400/80">
                {result.report.totalRows.toLocaleString()} rows processed
              </p>
            </div>

            {/* Tier counts */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Tier distribution
              </p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {(["inner_circle", "close", "warm", "cold"] as const).map((t) => (
                  <div key={t} className="rounded-xl border border-border p-3 text-center">
                    <p className="text-xl font-bold">
                      {result.report.tierCounts[t].toLocaleString()}
                    </p>
                    <p className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                      {t.replace("_", " ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Import stats
              </p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Callable (phone + eligible)</span>
                  <span className="font-mono">{result.report.callableCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Phone numbers</span>
                  <span className="font-mono">{result.report.phoneCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Duplicate phone entries</span>
                  <span className="font-mono text-amber-400">
                    {result.report.duplicatePhones}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Quarantined</span>
                  <span className="font-mono text-amber-400">
                    {result.report.quarantinedCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Rejected rows</span>
                  <span className="font-mono text-red-400">
                    {result.report.rejectedRows}
                  </span>
                </div>
              </div>
            </div>

            {/* Quarantine details */}
            {result.report.quarantinedCount > 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-400">
                  Quarantine reasons
                </p>
                <div className="mt-2 space-y-1">
                  {Object.entries(result.report.quarantinedReasons).map(([r, c]) => (
                    <div key={r} className="flex justify-between text-xs text-amber-400/80">
                      <span>{r}</span>
                      <span className="font-mono">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Duplicate phones */}
            {result.report.duplicatePhones > 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-400">
                  Duplicate phone groups ({result.report.duplicatePhoneGroups.length})
                </p>
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {result.report.duplicatePhoneGroups.slice(0, 20).map((g, i) => (
                    <div key={i} className="text-[10px] text-amber-400/70">
                      {g.phone}: {g.contacts.length} contacts
                    </div>
                  ))}
                  {result.report.duplicatePhoneGroups.length > 20 && (
                    <p className="text-xs text-muted-foreground">
                      …and {result.report.duplicatePhoneGroups.length - 20} more groups
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Rejected rows */}
            {result.report.rejectionReasons.length > 0 && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-red-400">
                  Rejected rows
                </p>
                <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                  {result.report.rejectionReasons.slice(0, 30).map((r, i) => (
                    <div key={i} className="text-[10px] text-red-400/70">
                      {r.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Link
                to="/powerdialer"
                className="flex-1 rounded-xl bg-primary py-3 text-center text-sm font-medium text-primary-foreground"
              >
                Go to Dashboard →
              </Link>
              <button
                onClick={handleReset}
                className="rounded-xl border border-red-500/30 px-4 py-3 text-xs text-red-400"
              >
                Clear & re-import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

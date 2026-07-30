// ── Powerdialer Export ──
// Export call log as CSV or JSON.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/powerdialer-db";
import { exportCallLogCSV, exportCallLogJSON } from "@/lib/v9-import";
import type { CallAttempt, V9Contact, Campaign } from "@/lib/powerdialer-types";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/powerdialer/export")({
  head: () => ({
    meta: [
      { title: "Powerdialer · Export" },
      { name: "description", content: "Export call log as CSV or JSON." },
    ],
  }),
  component: ExportPage,
});

function ExportPage() {
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);
  const [contacts, setContacts] = useState<V9Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      db.getAllCallAttempts(),
      db.getAllContacts(),
      db.getAllCampaigns(),
    ])
      .then(([att, con, cam]) => {
        setAttempts(att);
        setContacts(con);
        setCampaigns(cam);
      })
      .catch(() => toast.error("Failed to load export data"))
      .finally(() => setLoading(false));
  }, []);

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const downloadFile = (content: string, filename: string, mimeType: string, label: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${label} downloaded`);
  };

  const downloadCSV = () =>
    downloadFile(
      exportCallLogCSV(attempts, contacts, campaigns),
      `PROJECT_PLANE_JANE_POWERDIALER_CALL_LOG_${dateStamp}.csv`,
      "text/csv",
      "CSV",
    );

  const downloadJSON = () =>
    downloadFile(
      exportCallLogJSON(attempts, contacts),
      `POWERDIALER_CALL_LOG_${dateStamp}.json`,
      "application/json",
      "JSON",
    );

  const outcomes = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attempts) {
      if (a.outcome) {
        m.set(a.outcome, (m.get(a.outcome) || 0) + 1);
      }
    }
    return m;
  }, [attempts]);

  return (
    <div className="min-h-screen pb-20">
      <Toaster theme="dark" richColors position="top-center" />

      <header className="border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <Link to="/powerdialer" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Dashboard
        </Link>
        <h1 className="mt-1 font-serif text-2xl">Export Call Log</h1>
      </header>

      <div className="mx-auto max-w-md px-5 py-8">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5">
            {/* Summary */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Summary
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border border-border p-3">
                  <p className="text-2xl font-bold">{attempts.length}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">
                    Total attempts
                  </p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-2xl font-bold">
                    {attempts.filter((a) => a.loggedAt).length}
                  </p>
                  <p className="text-[10px] uppercase text-muted-foreground">
                    With outcomes
                  </p>
                </div>
              </div>
            </div>

            {/* Outcome breakdown */}
            {outcomes.size > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Outcomes
                </p>
                <div className="mt-2 space-y-1">
                  {[...outcomes.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([o, c]) => (
                      <div key={o} className="flex justify-between text-sm">
                        <span>{o}</span>
                        <span className="font-mono">{c}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Download buttons */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Download format
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={downloadCSV}
                  disabled={attempts.length === 0}
                  className="rounded-xl border border-border bg-input/30 px-4 py-4 text-center text-sm font-medium transition-all hover:border-primary active:scale-95 disabled:opacity-30"
                >
                  CSV
                  <br />
                  <span className="text-[10px] text-muted-foreground">
                    {attempts.filter((a) => a.loggedAt).length} logged
                  </span>
                </button>
                <button
                  onClick={downloadJSON}
                  disabled={attempts.length === 0}
                  className="rounded-xl border border-border bg-input/30 px-4 py-4 text-center text-sm font-medium transition-all hover:border-primary active:scale-95 disabled:opacity-30"
                >
                  JSON
                  <br />
                  <span className="text-[10px] text-muted-foreground">
                    Enriched with contact data
                  </span>
                </button>
              </div>
            </div>

            {/* Schema reference */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                CSV schema
              </p>
              <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                attempt_id,logged_at,called_by,campaign_id,source_board,
                contact_id,contact_name,tier,email,phone_e164,company,title,
                attempt_number,channel,outcome,next_step,next_step_due,
                commitment_status,commitment_details,notes,evidence_reference
              </p>
            </div>

            <Link
              to="/powerdialer/log"
              className="block rounded-2xl border border-border bg-card px-5 py-4 text-center text-sm"
            >
              View call log →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

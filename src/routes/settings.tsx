import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { parseVCF, type Contact } from "@/lib/vcf";
import { store } from "@/lib/store";
import { checkSyncStatus } from "@/lib/enrichment.functions";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Memory Center · Settings" },
      { name: "description", content: "Upload contacts, company context, and connect your Notion CRM." },
      { property: "og:title", content: "Memory Center · Settings" },
      { property: "og:description", content: "Your soul-centric dialer memory." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyMd, setCompanyMd] = useState("");
  const [notionDb, setNotionDb] = useState("");
  const [motivation, setMotivation] = useState("");
  const [sync, setSync] = useState<{ notion: boolean; gcal: boolean; gmail: boolean } | null>(null);
  const checkFn = useServerFn(checkSyncStatus);

  useEffect(() => {
    setContacts(store.getContacts());
    setCompanyMd(store.getCompanyMd());
    setNotionDb(store.getNotionDb());
    setMotivation(store.getMotivation());
    checkFn().then(setSync).catch(() => setSync({ notion: false, gcal: false, gmail: false }));
  }, []);

  const onVcf = async (f: File) => {
    const txt = await f.text();
    const parsed = parseVCF(txt);
    if (!parsed.length) return toast.error("No contacts found in file");
    store.setContacts(parsed);
    store.setQueueIdx(0);
    setContacts(parsed);
    toast.success(`Loaded ${parsed.length} contacts`);
  };

  const onMd = async (f: File) => {
    const txt = await f.text();
    store.setCompanyMd(txt);
    setCompanyMd(txt);
    toast.success("Company context saved");
  };

  return (
    <div className="min-h-screen pb-24">
      <Toaster theme="dark" richColors position="top-center" />
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Back
        </Link>
        <h1 className="mt-1 font-serif text-2xl">Memory Center</h1>
        <p className="text-sm text-muted-foreground">Everything the dialer draws from.</p>
      </header>

      <div className="space-y-6 px-5 py-6">
        <Section
          label="Contacts"
          sub={`${contacts.length} loaded${contacts.length ? ` · queue starts at #${store.getQueueIdx() + 1}` : ""}`}
        >
          <FileRow
            accept=".vcf,text/vcard"
            label="Upload .vcf"
            onFile={onVcf}
          />
          {contacts.length > 0 && (
            <ul className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border bg-card/40 text-sm">
              {contacts.slice(0, 25).map((c) => (
                <li key={c.id} className="border-b border-border/50 px-3 py-2 last:border-0">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.phone || "—"} {c.org ? `· ${c.org}` : ""}
                  </div>
                </li>
              ))}
              {contacts.length > 25 && (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  +{contacts.length - 25} more
                </li>
              )}
            </ul>
          )}
        </Section>

        <Section label="Company context" sub=".md file — pitch draws from this">
          <FileRow accept=".md,.txt,text/markdown" label="Upload .md" onFile={onMd} />
          {companyMd && (
            <p className="mt-2 line-clamp-3 rounded-lg border border-border bg-card/40 p-3 text-xs text-muted-foreground">
              {companyMd.slice(0, 240)}
              {companyMd.length > 240 ? "…" : ""}
            </p>
          )}
        </Section>

        <Section label="Notion CRM" sub="Paste your database URL or ID">
          <input
            value={notionDb}
            onChange={(e) => setNotionDb(e.target.value)}
            onBlur={() => {
              store.setNotionDb(notionDb.trim());
              if (notionDb.trim()) toast.success("Notion database saved");
            }}
            placeholder="https://notion.so/…?v=…"
            className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Notion is connected. Share this database with the integration in Notion so writes succeed.
          </p>
        </Section>

        <Section label="Motivation seed" sub="The narrow, high-conviction read the app riffs on">
          <textarea
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            onBlur={() => store.setMotivation(motivation)}
            rows={7}
            className="w-full resize-none rounded-lg border border-border bg-input/40 px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary"
          />
        </Section>

        <Section label="Google sync" sub="Calendar + Gmail feed into each contact's timeline">
          <div className="grid grid-cols-2 gap-2">
            <StatusChip label="Calendar" ok={!!sync?.gcal} />
            <StatusChip label="Gmail" ok={!!sync?.gmail} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Both connect via your builder account (single-user mode). Events + email threads with each contact appear on the call screen.
          </p>
        </Section>

        <Section label="iPhone-only signals" sub="iMessage · WhatsApp · native call history">
          <p className="rounded-lg border border-dashed border-border bg-card/40 p-3 text-xs text-muted-foreground">
            Apple doesn't let web apps read these directly. Tap iMessage/WhatsApp on the call screen to open the native thread — POST-call notes capture what you talked about.
          </p>
        </Section>
      </div>
    </div>
  );
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
        ok ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-primary" : "bg-muted-foreground/40"}`} />
    </div>
  );
}

function Section({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="font-serif text-lg">{label}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function FileRow({ accept, label, onFile }: { accept: string; label: string; onFile: (f: File) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-primary/50 bg-primary/5 px-4 py-4 text-sm font-medium text-primary transition-colors hover:bg-primary/10">
      {label}
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
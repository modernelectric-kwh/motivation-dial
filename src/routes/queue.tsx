import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { type Contact } from "@/lib/vcf";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "Memory Center · Queue" },
      { name: "description", content: "Reorder and pick your next call." },
      { property: "og:title", content: "Memory Center · Queue" },
      { property: "og:description", content: "Pick the next call." },
    ],
  }),
  component: Queue,
});

function Queue() {
  const nav = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [idx, setIdx] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setContacts(store.getContacts());
    setIdx(store.getQueueIdx());
  }, []);

  const jumpTo = (i: number) => {
    store.setQueueIdx(i);
    setIdx(i);
    nav({ to: "/call" });
  };

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= contacts.length) return;
    const next = [...contacts];
    [next[from], next[to]] = [next[to], next[from]];
    setContacts(next);
    store.setContacts(next);
  };

  const filtered = contacts
    .map((c, i) => ({ c, i }))
    .filter(({ c }) =>
      search
        ? [c.name, c.org, c.phone].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase())
        : true,
    );

  return (
    <div className="min-h-screen pb-12">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Back
        </Link>
        <h1 className="mt-1 font-serif text-2xl">Queue</h1>
        <p className="text-sm text-muted-foreground">
          {contacts.length} contacts · at #{idx + 1}
        </p>
      </header>

      <div className="px-5 py-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, org, phone…"
          className="w-full rounded-full border border-border bg-input/40 px-4 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <ul className="space-y-2 px-5">
        {filtered.map(({ c, i }) => {
          const done = i < idx;
          const current = i === idx;
          return (
            <li
              key={c.id}
              className={`flex items-center gap-3 rounded-2xl border p-3 ${
                current
                  ? "border-primary bg-primary/10"
                  : done
                    ? "border-border/50 bg-card/30 opacity-60"
                    : "border-border bg-card"
              }`}
            >
              <span className="w-8 shrink-0 text-center font-mono text-xs text-muted-foreground">
                {i + 1}
              </span>
              <button
                onClick={() => jumpTo(i)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.phone || "—"} {c.org ? `· ${c.org}` : ""}
                </div>
              </button>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  onClick={() => move(i, -1)}
                  className="h-6 w-6 rounded border border-border text-xs text-muted-foreground"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  className="h-6 w-6 rounded border border-border text-xs text-muted-foreground"
                  aria-label="Move down"
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {contacts.length === 0 ? "No contacts uploaded yet." : "No matches."}
          </li>
        )}
      </ul>
    </div>
  );
}
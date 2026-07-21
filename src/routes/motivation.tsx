import { createFileRoute, Link } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { store } from "@/lib/store";

export const Route = createFileRoute("/motivation")({
  head: () => ({
    meta: [
      { title: "Memory Center · Motivation" },
      { name: "description", content: "Chino's soul-centric inner voice between calls." },
      { property: "og:title", content: "Memory Center · Motivation" },
      { property: "og:description", content: "Ride mission, not verdict." },
    ],
  }),
  component: Motivation,
});

function Motivation() {
  const [ctx, setCtx] = useState<{ motivationSeed: string; companyContext: string } | null>(null);
  useEffect(() => {
    setCtx({
      motivationSeed: store.getMotivation(),
      companyContext: store.getCompanyMd(),
    });
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: ctx ?? {},
      }),
    [ctx],
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  const quickPrompts = [
    "Reset me before this next call.",
    "Am I in mission mode or verdict mode right now?",
    "Remind me why energy reliability matters.",
    "I'm dragging. Push me.",
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Back
        </Link>
        <h1 className="mt-1 font-serif text-2xl">Motivation</h1>
        <p className="text-sm text-muted-foreground">The convo for Chino.</p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 p-5">
              <p className="font-serif text-lg leading-snug">
                "Win because the problem matters — not so you'll finally feel worthy."
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Healthy mode
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage({ text: p })}
                  className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:border-primary/50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card"
              }`}
            >
              {m.parts.map((part, i) =>
                part.type === "text" ? (
                  <span key={i} className="whitespace-pre-wrap">
                    {part.text}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        ))}
        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <span className="inline-flex gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="sticky bottom-0 border-t border-border bg-background/95 p-4 backdrop-blur"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Talk to yourself, sharpened…"
            className="flex-1 rounded-full border border-border bg-input/40 px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={!input.trim() || status === "submitted" || status === "streaming"}
            className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
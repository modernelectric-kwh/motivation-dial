// Parsers for ChatGPT and Claude data exports.
// ChatGPT: users download conversations.json from Settings → Data controls → Export.
// Claude: users download conversations.json from Settings → Privacy → Export data.
// Perplexity has no export — we query it live via API for context on a contact.

import type { ChatContext } from "./store";

interface ChatGPTMessage {
  author?: { role?: string };
  content?: { parts?: unknown[] };
  create_time?: number;
}
interface ChatGPTConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, { message?: ChatGPTMessage | null }>;
}

interface ClaudeConversation {
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: Array<{
    sender?: string;
    text?: string;
    created_at?: string;
  }>;
}

function firstText(parts: unknown[] | undefined): string {
  if (!parts) return "";
  for (const p of parts) {
    if (typeof p === "string") return p;
    if (p && typeof p === "object" && "text" in p) {
      const t = (p as { text?: unknown }).text;
      if (typeof t === "string") return t;
    }
  }
  return "";
}

/**
 * Parse ChatGPT conversations.json. Returns a condensed digest to feed models
 * without shipping the entire archive around.
 */
export function parseChatGPTExport(raw: string): ChatContext {
  const data = JSON.parse(raw) as ChatGPTConversation[] | { conversations?: ChatGPTConversation[] };
  const convs: ChatGPTConversation[] = Array.isArray(data)
    ? data
    : (data.conversations ?? []);
  const lines: string[] = [];
  let count = 0;
  for (const c of convs.slice(0, 500)) {
    const title = c.title?.trim();
    if (!title) continue;
    // Extract first user prompt + last assistant answer as a compact snapshot
    const msgs = Object.values(c.mapping ?? {})
      .map((m) => m?.message)
      .filter(Boolean) as ChatGPTMessage[];
    const userMsg = msgs.find((m) => m.author?.role === "user");
    const asstMsg = [...msgs].reverse().find((m) => m.author?.role === "assistant");
    const userTxt = firstText(userMsg?.content?.parts).slice(0, 180);
    const asstTxt = firstText(asstMsg?.content?.parts).slice(0, 220);
    lines.push(`• ${title} — Q: ${userTxt} → A: ${asstTxt}`);
    count += 1;
  }
  return {
    source: "chatgpt",
    updatedAt: new Date().toISOString(),
    entryCount: count,
    digest: lines.slice(0, 200).join("\n"),
  };
}

/**
 * Parse Claude conversations.json.
 */
export function parseClaudeExport(raw: string): ChatContext {
  const data = JSON.parse(raw) as ClaudeConversation[] | { conversations?: ClaudeConversation[] };
  const convs: ClaudeConversation[] = Array.isArray(data)
    ? data
    : (data.conversations ?? []);
  const lines: string[] = [];
  let count = 0;
  for (const c of convs.slice(0, 500)) {
    const title = c.name?.trim() || "(untitled)";
    const msgs = c.chat_messages ?? [];
    const userMsg = msgs.find((m) => m.sender === "human");
    const asstMsg = [...msgs].reverse().find((m) => m.sender === "assistant");
    const userTxt = (userMsg?.text ?? "").slice(0, 180);
    const asstTxt = (asstMsg?.text ?? "").slice(0, 220);
    lines.push(`• ${title} — Q: ${userTxt} → A: ${asstTxt}`);
    count += 1;
  }
  return {
    source: "claude",
    updatedAt: new Date().toISOString(),
    entryCount: count,
    digest: lines.slice(0, 200).join("\n"),
  };
}
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://connector-gateway.lovable.dev";

export interface TimelineEntry {
  source: "notion" | "gcal" | "gmail" | "local";
  at: string; // ISO
  title: string;
  snippet?: string;
  url?: string;
}

function needKeys() {
  const lov = process.env.LOVABLE_API_KEY;
  if (!lov) throw new Error("LOVABLE_API_KEY missing");
  return lov;
}

const ContactInput = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  notionDb: z.string().optional(),
});

function parseNotionDbId(input: string): string | null {
  const raw = input.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];
  if (!raw) return null;
  return raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

async function notionHistory(name: string, dbUrl: string, lov: string): Promise<TimelineEntry[]> {
  const notionKey = process.env.NOTION_API_KEY;
  if (!notionKey) return [];
  const dbId = parseNotionDbId(dbUrl);
  if (!dbId) return [];
  const res = await fetch(`${GATEWAY}/notion/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lov}`,
      "X-Connection-Api-Key": notionKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 20 }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      id: string;
      url?: string;
      created_time?: string;
      last_edited_time?: string;
      properties?: Record<string, { type: string; title?: Array<{ plain_text?: string }> }>;
    }>;
  };
  const needle = name.toLowerCase();
  const out: TimelineEntry[] = [];
  for (const p of data.results ?? []) {
    const titleProp = Object.values(p.properties ?? {}).find((v) => v.type === "title");
    const title = titleProp?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
    if (!title.toLowerCase().includes(needle)) continue;
    out.push({
      source: "notion",
      at: p.last_edited_time ?? p.created_time ?? new Date().toISOString(),
      title: title || "Untitled Notion page",
      url: p.url,
    });
  }
  return out;
}

async function gcalHistory(email: string | undefined, name: string, lov: string): Promise<TimelineEntry[]> {
  const key = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!key) return [];
  const q = email || name;
  const params = new URLSearchParams({
    q,
    maxResults: "10",
    orderBy: "startTime",
    singleEvents: "true",
    timeMin: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString(),
  });
  const res = await fetch(
    `${GATEWAY}/google_calendar/calendar/v3/calendars/primary/events?${params}`,
    {
      headers: {
        Authorization: `Bearer ${lov}`,
        "X-Connection-Api-Key": key,
      },
    },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items?: Array<{
      summary?: string;
      start?: { dateTime?: string; date?: string };
      htmlLink?: string;
      description?: string;
    }>;
  };
  return (data.items ?? []).map((e) => ({
    source: "gcal" as const,
    at: e.start?.dateTime ?? e.start?.date ?? new Date().toISOString(),
    title: e.summary ?? "Calendar event",
    snippet: e.description?.slice(0, 160),
    url: e.htmlLink,
  }));
}

async function gmailHistory(email: string | undefined, lov: string): Promise<TimelineEntry[]> {
  if (!email) return [];
  const key = process.env.GOOGLE_MAIL_API_KEY;
  if (!key) return [];
  const q = `from:${email} OR to:${email}`;
  const list = await fetch(
    `${GATEWAY}/google_mail/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent(q)}`,
    {
      headers: {
        Authorization: `Bearer ${lov}`,
        "X-Connection-Api-Key": key,
      },
    },
  );
  if (!list.ok) return [];
  const listData = (await list.json()) as { messages?: Array<{ id: string }> };
  const ids = (listData.messages ?? []).slice(0, 5);
  const out: TimelineEntry[] = [];
  await Promise.all(
    ids.map(async ({ id }) => {
      const r = await fetch(
        `${GATEWAY}/google_mail/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: {
            Authorization: `Bearer ${lov}`,
            "X-Connection-Api-Key": key,
          },
        },
      );
      if (!r.ok) return;
      const m = (await r.json()) as {
        payload?: { headers?: Array<{ name: string; value: string }> };
        snippet?: string;
        internalDate?: string;
      };
      const headers = m.payload?.headers ?? [];
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "(no subject)";
      const date = headers.find((h) => h.name.toLowerCase() === "date")?.value;
      out.push({
        source: "gmail",
        at: date ? new Date(date).toISOString() : new Date(Number(m.internalDate ?? Date.now())).toISOString(),
        title: subject,
        snippet: m.snippet,
      });
    }),
  );
  return out;
}

export const fetchEnrichedTimeline = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => ContactInput.parse(raw))
  .handler(async ({ data }) => {
    const lov = needKeys();
    const results = await Promise.allSettled([
      data.notionDb ? notionHistory(data.name, data.notionDb, lov) : Promise.resolve([]),
      gcalHistory(data.email, data.name, lov),
      gmailHistory(data.email, lov),
    ]);
    const entries: TimelineEntry[] = [];
    const errors: Record<string, string> = {};
    (["notion", "gcal", "gmail"] as const).forEach((label, i) => {
      const r = results[i];
      if (r.status === "fulfilled") entries.push(...r.value);
      else errors[label] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    });
    entries.sort((a, b) => (b.at > a.at ? 1 : -1));
    return { entries, errors };
  });

export const checkSyncStatus = createServerFn({ method: "GET" }).handler(async () => {
  return {
    notion: !!process.env.NOTION_API_KEY,
    gcal: !!process.env.GOOGLE_CALENDAR_API_KEY,
    gmail: !!process.env.GOOGLE_MAIL_API_KEY,
  };
});
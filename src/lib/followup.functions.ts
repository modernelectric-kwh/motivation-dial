import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ---------- CALENDAR PLACEHOLDER ----------
const CalendarInput = z.object({
  firstName: z.string(),
  email: z.string().optional(),
});

function toPTIso(dayOffset: number, hour: number, minute = 0): { start: Date; end: Date } {
  const now = new Date();
  const target = new Date(now.getTime());
  target.setUTCDate(target.getUTCDate() + dayOffset);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(target).map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const pretend = new Date(Date.UTC(y, m - 1, d, hour, minute));
  const asPT = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(pretend);
  const [ptH, ptM] = asPT.split(":").map(Number);
  const diffMinutes = (hour * 60 + minute) - (ptH * 60 + ptM);
  const start = new Date(pretend.getTime() + diffMinutes * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { start, end };
}

export const sendCalendarPlaceholder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => CalendarInput.parse(raw))
  .handler(async ({ data }) => {
    const lovKey = process.env.LOVABLE_API_KEY;
    const gcalKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!lovKey || !gcalKey) throw new Error("Google Calendar not connected");

    const first = data.firstName.split(/\s+/)[0] || data.firstName;
    const summary = `${first} <> Chino - Catch up?`;

    const slot1 = toPTIso(1, 13, 0);
    const slot2 = toPTIso(1, 14, 0);

    const fb = await fetch(
      "https://connector-gateway.lovable.dev/google_calendar/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovKey}`,
          "X-Connection-Api-Key": gcalKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin: slot1.start.toISOString(),
          timeMax: slot2.end.toISOString(),
          items: [{ id: "primary" }],
        }),
      },
    );
    if (!fb.ok) {
      const t = await fb.text();
      throw new Error(`freeBusy ${fb.status}: ${t}`);
    }
    const fbJson = (await fb.json()) as {
      calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } };
    };
    const busy = fbJson.calendars?.primary?.busy ?? [];
    const overlaps = (s: Date, e: Date) =>
      busy.some((b) => new Date(b.start) < e && new Date(b.end) > s);
    const chosen = !overlaps(slot1.start, slot1.end)
      ? slot1
      : !overlaps(slot2.start, slot2.end)
        ? slot2
        : slot1;

    const event = {
      summary,
      description:
        "Placeholder to catch up. Move or decline freely — cal.com/chinolex/call for a real booking.",
      start: { dateTime: chosen.start.toISOString(), timeZone: "America/Los_Angeles" },
      end: { dateTime: chosen.end.toISOString(), timeZone: "America/Los_Angeles" },
      attendees: data.email ? [{ email: data.email }] : [],
      guestsCanModify: true,
    };

    const create = await fetch(
      "https://connector-gateway.lovable.dev/google_calendar/calendar/v3/calendars/primary/events?sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovKey}`,
          "X-Connection-Api-Key": gcalKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      },
    );
    if (!create.ok) {
      const t = await create.text();
      throw new Error(`calendar create ${create.status}: ${t}`);
    }
    const created = (await create.json()) as { htmlLink?: string };
    return {
      ok: true as const,
      slot: chosen.start.toISOString(),
      link: created.htmlLink,
    };
  });

// ---------- PERPLEXITY LIVE BRIEF ----------
const PerplexityInput = z.object({
  name: z.string(),
  org: z.string().optional(),
});

export const queryPerplexityContext = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => PerplexityInput.parse(raw))
  .handler(async ({ data }) => {
    const key = process.env.PERPLEXITY_API_KEY;
    if (!key) throw new Error("Perplexity not connected");

    const q = `Who is ${data.name}${data.org ? ` at ${data.org}` : ""}? Give a 4-line brief: current role, recent public activity, common ground with an energy-reliability founder, one warm opener. Cite links.`;

    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "You are terse. 4 lines max. No fluff." },
          { role: "user", content: q },
        ],
        search_recency_filter: "month",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 && body.includes("insufficient_quota")) {
        throw new Error(
          "Perplexity API credits exhausted. Add credits at console.perplexity.ai.",
        );
      }
      throw new Error(`Perplexity ${res.status}: ${body}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      citations?: string[];
    };
    return {
      brief: json.choices?.[0]?.message?.content ?? "",
      citations: json.citations ?? [],
    };
  });

// ---------- FOLLOW-UP EMAIL DRAFT ----------
const EmailInput = z.object({
  to: z.string(),
  firstName: z.string(),
  subject: z.string(),
  template: z.string(),
  notes: z.string().optional(),
});

function base64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const draftFollowupEmail = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => EmailInput.parse(raw))
  .handler(async ({ data }) => {
    const lovKey = process.env.LOVABLE_API_KEY;
    const gmailKey = process.env.GOOGLE_MAIL_API_KEY;
    if (!lovKey || !gmailKey) throw new Error("Gmail not connected");

    const body = data.template.replace(/{{first}}/g, data.firstName);
    const withNotes = data.notes
      ? `${body}\n\n---\nNotes from the call:\n${data.notes}`
      : body;

    const raw = base64url(
      [
        `To: ${data.to}`,
        `Subject: ${data.subject}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        withNotes,
      ].join("\r\n"),
    );

    const res = await fetch(
      "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/drafts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovKey}`,
          "X-Connection-Api-Key": gmailKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: { raw } }),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gmail draft ${res.status}: ${t}`);
    }
    const j = (await res.json()) as { id?: string };
    return { ok: true as const, draftId: j.id };
  });
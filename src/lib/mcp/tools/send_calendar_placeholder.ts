import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

function toPTIso(dayOffset: number, hour: number, minute = 0) {
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
  const diffMinutes = hour * 60 + minute - (ptH * 60 + ptM);
  const start = new Date(pretend.getTime() + diffMinutes * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { start, end };
}

export default defineTool({
  name: "send_calendar_placeholder",
  title: "Send calendar placeholder",
  description:
    "Create a 30-minute Google Calendar placeholder titled '{firstName} <> Chino - Catch up?' tomorrow at 1pm or 2pm PT (whichever is free) and invite the attendee's email.",
  inputSchema: {
    firstName: z.string().describe("First name of the invitee."),
    email: z.string().optional().describe("Invitee email address (optional)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  handler: async ({ firstName, email }) => {
    const lovKey = process.env.LOVABLE_API_KEY;
    const gcalKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!lovKey || !gcalKey) {
      return {
        content: [{ type: "text", text: "Google Calendar connector not linked." }],
        isError: true,
      };
    }
    const first = firstName.split(/\s+/)[0] || firstName;
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
      return {
        content: [{ type: "text", text: `freeBusy ${fb.status}: ${await fb.text()}` }],
        isError: true,
      };
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
      attendees: email ? [{ email }] : [],
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
      return {
        content: [{ type: "text", text: `calendar create ${create.status}: ${await create.text()}` }],
        isError: true,
      };
    }
    const created = (await create.json()) as { htmlLink?: string };
    return {
      content: [
        {
          type: "text",
          text: `Placeholder created at ${chosen.start.toISOString()}${created.htmlLink ? ` — ${created.htmlLink}` : ""}`,
        },
      ],
      structuredContent: { start: chosen.start.toISOString(), link: created.htmlLink },
    };
  },
});
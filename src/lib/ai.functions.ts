import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  contactName: z.string(),
  contactOrg: z.string().optional(),
  companyContext: z.string(),
  motivationSeed: z.string(),
  lastNotes: z.string().optional(),
});

export const generateCallPrep = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => InputSchema.parse(raw))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const sys = `You prep Chino for outbound calls. Return STRICT JSON:
{"pitch": string (60-sec spoken pitch, 3 short paragraphs, warm but sharp),
 "motivation": string (one line, second-person, mission-first not verdict-first, evoking his soul-centric drivers)}
No preamble. No markdown fences.`;

    const user = `Contact: ${data.contactName}${data.contactOrg ? " @ " + data.contactOrg : ""}

COMPANY CONTEXT:
${data.companyContext || "(none provided)"}

MOTIVATION SEED (Chino's core drivers):
${data.motivationSeed}

LAST TOUCHPOINT:
${data.lastNotes || "(first contact)"}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`AI gateway ${res.status}: ${t}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(content) as { pitch?: string; motivation?: string };
      return {
        pitch: parsed.pitch ?? "",
        motivation: parsed.motivation ?? "",
      };
    } catch {
      return { pitch: content, motivation: "" };
    }
  });

const NotionSchema = z.object({
  databaseId: z.string(),
  contactName: z.string(),
  outcome: z.string(),
  notes: z.string(),
});

export const logToNotion = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => NotionSchema.parse(raw))
  .handler(async ({ data }) => {
    const lovKey = process.env.LOVABLE_API_KEY;
    const notionKey = process.env.NOTION_API_KEY;
    if (!lovKey || !notionKey) throw new Error("Notion connector env missing");

    // Extract raw ID (32 hex) from URL if a URL was pasted
    const rawId = data.databaseId.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];
    if (!rawId) throw new Error("Could not parse a Notion database ID from the value in Settings.");
    const dbId = rawId.replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      "$1-$2-$3-$4-$5",
    );

    // Discover the title property name
    const dbRes = await fetch(
      `https://connector-gateway.lovable.dev/notion/v1/databases/${dbId}`,
      {
        headers: {
          Authorization: `Bearer ${lovKey}`,
          "X-Connection-Api-Key": notionKey,
        },
      },
    );
    if (!dbRes.ok) {
      const t = await dbRes.text();
      throw new Error(`Notion DB fetch ${dbRes.status}: ${t}`);
    }
    const db = (await dbRes.json()) as {
      properties: Record<string, { type: string; name: string }>;
    };
    const titleProp = Object.entries(db.properties).find(
      ([, v]) => v.type === "title",
    )?.[0];
    if (!titleProp) throw new Error("No title property found on Notion DB");

    const title = `${data.contactName} — ${data.outcome} — ${new Date().toLocaleString()}`;
    const body = {
      parent: { database_id: dbId },
      properties: {
        [titleProp]: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
      children: data.notes
        ? [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content: data.notes } }],
              },
            },
          ]
        : [],
    };

    const res = await fetch(
      "https://connector-gateway.lovable.dev/notion/v1/pages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovKey}`,
          "X-Connection-Api-Key": notionKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Notion page create ${res.status}: ${t}`);
    }
    return { ok: true as const };
  });
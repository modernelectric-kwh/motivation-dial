import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "log_to_notion",
  title: "Log call to Notion CRM",
  description:
    "Create a page in Chino's Notion CRM database summarizing a call or interaction with a contact. Requires the Notion database ID/URL, contact name, outcome, and notes.",
  inputSchema: {
    databaseId: z
      .string()
      .describe("Notion database ID or URL for the CRM."),
    contactName: z.string().describe("Full name of the contact."),
    outcome: z
      .string()
      .describe(
        "Short outcome tag, e.g. connected, voicemail, callback, not-interested.",
      ),
    notes: z.string().describe("Freeform notes from the call."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  handler: async ({ databaseId, contactName, outcome, notes }) => {
    const lovKey = process.env.LOVABLE_API_KEY;
    const notionKey = process.env.NOTION_API_KEY;
    if (!lovKey || !notionKey) {
      return {
        content: [{ type: "text", text: "Notion connector is not linked to this project." }],
        isError: true,
      };
    }

    const rawId = databaseId.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];
    if (!rawId) {
      return {
        content: [{ type: "text", text: "Could not parse a Notion database ID." }],
        isError: true,
      };
    }
    const dbId = rawId.replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      "$1-$2-$3-$4-$5",
    );

    const dbRes = await fetch(
      `https://connector-gateway.lovable.dev/notion/v1/databases/${dbId}`,
      { headers: { Authorization: `Bearer ${lovKey}`, "X-Connection-Api-Key": notionKey } },
    );
    if (!dbRes.ok) {
      return {
        content: [{ type: "text", text: `Notion DB fetch ${dbRes.status}: ${await dbRes.text()}` }],
        isError: true,
      };
    }
    const db = (await dbRes.json()) as {
      properties: Record<string, { type: string; name: string }>;
    };
    const titleProp = Object.entries(db.properties).find(
      ([, v]) => v.type === "title",
    )?.[0];
    if (!titleProp) {
      return {
        content: [{ type: "text", text: "No title property found on Notion DB." }],
        isError: true,
      };
    }

    const title = `${contactName} — ${outcome} — ${new Date().toLocaleString()}`;
    const body = {
      parent: { database_id: dbId },
      properties: {
        [titleProp]: { title: [{ type: "text", text: { content: title } }] },
      },
      children: notes
        ? [
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ type: "text", text: { content: notes } }] },
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
      return {
        content: [{ type: "text", text: `Notion page create ${res.status}: ${await res.text()}` }],
        isError: true,
      };
    }
    const created = (await res.json()) as { id?: string; url?: string };
    return {
      content: [{ type: "text", text: `Logged to Notion: ${created.url ?? created.id ?? "ok"}` }],
      structuredContent: { id: created.id, url: created.url },
    };
  },
});
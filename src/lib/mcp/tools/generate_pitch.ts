import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "generate_pitch",
  title: "Generate a 60-second call pitch",
  description:
    "Generate a 60-second spoken pitch and a one-line motivation card for a contact, using Chino's soul-centric 4-motive stack. Returns JSON with pitch and motivation strings.",
  inputSchema: {
    contactName: z.string().describe("Full name of the contact."),
    contactOrg: z.string().optional().describe("Organization the contact is at."),
    companyContext: z.string().describe("Chino's company/product context (markdown)."),
    motivationSeed: z
      .string()
      .describe("Chino's motivation seed: mastery, protection, wealth, recognition drivers."),
    lastNotes: z.string().optional().describe("Notes from the last touchpoint, if any."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ contactName, contactOrg, companyContext, motivationSeed, lastNotes }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        content: [{ type: "text", text: "LOVABLE_API_KEY missing." }],
        isError: true,
      };
    }
    const sys = `You prep Chino for outbound calls. Return STRICT JSON:
{"pitch": string (60-sec spoken pitch, 3 short paragraphs, warm but sharp),
 "motivation": string (one line, second-person, mission-first not verdict-first)}
No preamble. No markdown fences.`;
    const user = `Contact: ${contactName}${contactOrg ? " @ " + contactOrg : ""}

COMPANY CONTEXT:
${companyContext || "(none provided)"}

MOTIVATION SEED:
${motivationSeed}

LAST TOUCHPOINT:
${lastNotes || "(first contact)"}`;
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
      return {
        content: [{ type: "text", text: `AI gateway ${res.status}: ${await res.text()}` }],
        isError: true,
      };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { pitch?: string; motivation?: string } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { pitch: content };
    }
    return {
      content: [
        {
          type: "text",
          text: `MOTIVATION: ${parsed.motivation ?? ""}\n\nPITCH:\n${parsed.pitch ?? ""}`,
        },
      ],
      structuredContent: { pitch: parsed.pitch ?? "", motivation: parsed.motivation ?? "" },
    };
  },
});
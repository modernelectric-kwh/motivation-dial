import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "perplexity_brief",
  title: "Perplexity brief on a person",
  description:
    "Get a 4-line live brief on a person (current role, recent activity, common ground with an energy-reliability founder, one warm opener) with citations, via Perplexity.",
  inputSchema: {
    name: z.string().describe("Full name of the person."),
    org: z.string().optional().describe("Organization the person is at (optional)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ name, org }) => {
    const key = process.env.PERPLEXITY_API_KEY;
    if (!key) {
      return {
        content: [{ type: "text", text: "Perplexity connector not linked." }],
        isError: true,
      };
    }
    const q = `Who is ${name}${org ? ` at ${org}` : ""}? Give a 4-line brief: current role, recent public activity, common ground with an energy-reliability founder, one warm opener. Cite links.`;
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
      return {
        content: [{ type: "text", text: `Perplexity ${res.status}: ${await res.text()}` }],
        isError: true,
      };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      citations?: string[];
    };
    const brief = json.choices?.[0]?.message?.content ?? "";
    const citations = json.citations ?? [];
    return {
      content: [
        { type: "text", text: brief + (citations.length ? `\n\nCitations:\n${citations.join("\n")}` : "") },
      ],
      structuredContent: { brief, citations },
    };
  },
});
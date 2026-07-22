import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

function base64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default defineTool({
  name: "draft_gmail_email",
  title: "Draft a Gmail email",
  description:
    "Create a draft email in Chino's Gmail using the connected Google account. Does NOT send — the draft appears in the Drafts folder for review.",
  inputSchema: {
    to: z.string().describe("Recipient email address."),
    subject: z.string().describe("Email subject line."),
    body: z.string().describe("Plain-text email body."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  handler: async ({ to, subject, body }) => {
    const lovKey = process.env.LOVABLE_API_KEY;
    const gmailKey = process.env.GOOGLE_MAIL_API_KEY;
    if (!lovKey || !gmailKey) {
      return {
        content: [{ type: "text", text: "Gmail connector is not linked." }],
        isError: true,
      };
    }
    const raw = base64url(
      [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        body,
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
      return {
        content: [{ type: "text", text: `Gmail draft ${res.status}: ${await res.text()}` }],
        isError: true,
      };
    }
    const j = (await res.json()) as { id?: string };
    return {
      content: [{ type: "text", text: `Draft created (id: ${j.id ?? "unknown"}). Review in Gmail Drafts.` }],
      structuredContent: { draftId: j.id },
    };
  },
});
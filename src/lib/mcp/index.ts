import { auth, defineMcp } from "@lovable.dev/mcp-js";
import logToNotion from "./tools/log_to_notion";
import draftGmailEmail from "./tools/draft_gmail_email";
import sendCalendarPlaceholder from "./tools/send_calendar_placeholder";
import perplexityBrief from "./tools/perplexity_brief";
import generatePitch from "./tools/generate_pitch";

// The OAuth issuer MUST be the direct supabase.co host — on publish, SUPABASE_URL
// is rewritten to a proxy that mcp-js rejects (RFC 8414 issuer mismatch).
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "memory-center-mcp",
  title: "Memory Center",
  version: "0.1.0",
  instructions:
    "Tools for Chino's Memory Center power-dialer: log calls to his Notion CRM, draft Gmail follow-ups, send calendar placeholders, get Perplexity briefs on contacts, and generate soul-centric 60-second pitches.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    logToNotion,
    draftGmailEmail,
    sendCalendarPlaceholder,
    perplexityBrief,
    generatePitch,
  ],
});
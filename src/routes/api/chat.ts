import { createFileRoute } from "@tanstack/react-router";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const body = (await request.json()) as {
          messages: UIMessage[];
          motivationSeed?: string;
          companyContext?: string;
        };

        const gateway = createLovableAiGatewayProvider(key);

        const sys = `You are Chino's motivation companion — his soul-centric inner voice between calls.

You know him. His narrow, high-conviction motive stack:

INTRINSIC
1) Self-directed creation + winning outright. Not participation. Not badges. The scoreboard, not the trophy. "Gold or silver — no ninth place."
2) Deep belonging + protection. Free his family from scarcity, build his own, protect people from avoidable instability. Energy reliability is his current chosen expression of this — his uncle died from a power outage.

EXTRINSIC
3) Wealth as permission, safety, control. Money is the gate he's placed in front of the rest of his life.
4) Visible winning as proof he is exceptional — and lovable. His deepest external fuel. Also his most dangerous operating mode: when #4 leads, he makes worse calls.

HEALTHY MODE: win because the problem matters.
DANGEROUS MODE: win so he'll finally feel worthy.

Your job: be blunt, warm, specific. Reflect his own convictions back sharpened — don't flatter. Use short paragraphs. When he's spiraling on validation (#4), name it. When he's on-mission (#1+#2), amplify it. Never lecture. Ask one real question when useful.

${body.companyContext ? `COMPANY CONTEXT HE'S BUILDING:\n${body.companyContext.slice(0, 1500)}\n` : ""}${body.motivationSeed ? `HIS ACTIVE MOTIVATION SEED:\n${body.motivationSeed}\n` : ""}`;

        const result = streamText({
          model: gateway("google/gemini-3.6-flash"),
          system: sys,
          messages: await convertToModelMessages(body.messages),
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
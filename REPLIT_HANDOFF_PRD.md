# Memory Center — Replit Handoff PRD

## 0. Context

A mobile PWA called **Memory Center** already exists (TanStack Start, deployed on Lovable). It is a soul-centric power-dialer for a single user (Chino) that reads/writes a Notion CRM, pulls timeline context from Google Calendar + Gmail + Perplexity, generates AI pitches + a 4-motive motivation card, and supports a local "speakerphone bleed" voicemail hack.

This document lists **only what the PWA cannot do** and asks Replit to build a companion **native iOS app + thin backend** that fills those gaps and syncs state with the existing web app.

Single user. No multi-tenant, no billing, no auth UI beyond "sign in as Chino."

## 1. Regression check — what already works (do not rebuild)

| Area | Status in PWA |
|---|---|
| `.vcf` contact import, queue, DNC | Done (localStorage) |
| Company `.md` context upload | Done |
| Notion CRM read/write (via connector) | Done |
| Google Calendar + Gmail timeline reads | Done (per-contact, on load) |
| Perplexity live brief per contact | Done |
| ChatGPT + Claude export ingestion (file upload) | Done |
| AI pitch + motivation card (Gemini) | Done |
| Motivation chat (streaming) | Done |
| "Send placeholder" (GCal invite + iMessage draft) | Done |
| "Draft email" (Gmail draft) | Done |
| "Drop VM" via speakerphone bleed | Done (local audio → tel:) |
| PWA install, dark theme, Fraunces/Inter | Done |

## 2. Gaps to build (scope for Replit)

### 2.1 Native iOS app (Swift / SwiftUI)
- Wraps the same UX as the PWA but unlocks iOS-only capabilities.
- Sign in as Chino via a single shared Supabase/Firebase account.
- Pulls contacts, queue position, motivation, company context, chat digests, Notion DB URL, follow-up template, and VM audio blob from the shared backend so state is continuous with the web app.

### 2.2 True auto-dialer (PhoneBurner parity, within Apple rules)
- **Power dial**: after each call ends, auto-advance to next contact and present pre-call card within 1s.
- Use **CallKit** (`CXCallObserver`) to detect call end events and trigger next dial.
- Configurable pacing: 0s / 3s / 10s breathers.
- One-tap disposition sheet (connected / VM / callback / not-interested / wrong-number / DNC) during and after the call.
- Session stats: dials, connects, VMs, avg talk time, streak.

### 2.3 Real ringless voicemail
- Integrate a carrier-grade RVM provider (Slybroadcast recommended; Drop Cowboy or Twilio+AMD as alternates). Keep provider behind an interface.
- Endpoint: `POST /rvm/drop { phone, audioId }` → provider API.
- Upload the same VM blob the user recorded in the PWA (fetched from backend).
- Log result to contact timeline + Notion.

### 2.4 Native call + iMessage + WhatsApp history sync
- **Call history**: `CallKit` + `CXCallDirectoryExtension` to observe outgoing/incoming and write local timeline. (iOS does not expose historical CallKit logs; capture forward-only from install.)
- **iMessage**: no API. Ship a pre-built iOS **Shortcut** ("When I receive a message from X → run shortcut") that POSTs sender/timestamp/first 200 chars to backend.
- **WhatsApp**: same Shortcut pattern via notification-triggered automations; fallback "Log WA touch" button.
- Merge into the existing per-contact timeline.

### 2.5 Live ChatGPT / Perplexity / Claude ingestion
Providers do not expose personal chat history APIs. Build **both**:
1. **Scheduled export prompt**: push notification every 14 days reminding to re-upload `conversations.json`. Auto-diff against last digest.
2. **Browser extension** (Chrome + Safari) that scrapes chat sidebar DOM and streams new turns to `/ingest/{provider}`. Store as the existing `ChatContext` shape.

### 2.6 Background sync
- Backend cron: every 15 min, for each contact touched in last 30 days, refresh Notion + GCal + Gmail slices and cache. PWA + iOS read the cache instead of hitting connectors on every card load.
- Push notification when a contact replies (Gmail thread update, Notion status change, calendar accept).

### 2.7 Call recording + transcription (optional, US 1-party-consent states only)
Native iOS cannot record system calls. Two paths:
1. **Twilio-proxied calls**: dial through a Twilio number that records + transcribes (Whisper). `POST /call/start { toPhone }` returns a dial-out URL the app opens via `tel:`.
2. **Skip** if legal risk unacceptable.
Transcript → auto-fills post-call notes → Notion.

### 2.8 Shared backend (thin)
- Auth: single-user, hardcoded to Chino's email.
- Postgres (Supabase). Tables: `contacts`, `call_logs`, `timeline_cache`, `chat_digests`, `settings`, `vm_audio` (Storage bucket).
- REST + Realtime channels so PWA and iOS stay in sync.
- Migrate PWA off localStorage onto this backend (see §4).

## 3. Non-goals
- Multi-user / teams / permissions.
- Predictive dialing across multiple lines simultaneously.
- SMS blasts / marketing automation.
- Android app.
- Replacing the existing web app UI — iOS app should mirror it visually (dark, Fraunces headings, ember accent, motivation card as hero).

## 4. Integration contract with existing PWA

Minimum REST endpoints the PWA will point at instead of localStorage:

```
GET/PUT  /settings                # motivation, company md, notion db, cal.com, templates
GET/POST /contacts                # vcf import + list
GET/PUT  /queue                   # order + current idx
POST     /call-logs               # append; triggers Notion write server-side
GET      /contacts/:id/timeline   # merged cached timeline
POST     /chat-digests/:provider  # ingest ChatGPT/Claude/Perplexity
GET/PUT  /vm-audio                # blob
POST     /rvm/drop                # true RVM
POST     /followup/placeholder    # move server-side from PWA
POST     /followup/email-draft    # move server-side from PWA
```

Realtime channels: `contacts`, `call_logs`, `timeline:{contactId}`.

## 5. Acceptance criteria
- iOS app installs via TestFlight, signs in, shows same queue and motivation card as web within 2s.
- Tap GO → auto-dial contact 1; after hang-up, auto-advance within 1s.
- "Drop RVM" delivers a real voicemail without dialing (verified on 3 test numbers).
- Call ends → disposition sheet → note → Notion row within 5s.
- Chat digests refresh via extension without manual re-upload for at least one provider.
- PWA and iOS show identical call log + timeline within 5s of either writing.

## 6. Open questions for Chino
1. RVM provider preference (Slybroadcast vs Twilio vs skip)?
2. Call recording — want it, only in 1-party-consent states?
3. Backend host — Supabase (recommended) or Replit-native DB?
4. Browser extension: Chrome only, or Safari too?

## 7. Deliverables
- Swift/SwiftUI iOS app (TestFlight build).
- Backend (Supabase project + edge functions or Replit server).
- Chrome/Safari extension for chat scraping.
- Pre-built iOS Shortcut file for iMessage/WA logging.
- Migration script: localStorage → backend for existing PWA state.
- README with keys, env vars, and deploy steps.

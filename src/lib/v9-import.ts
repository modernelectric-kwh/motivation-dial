// ── V9 Canonical CSV Importer ──
// Reads the 29,762-row CSV with 30 canonical columns.
// Deterministic contact IDs, quarantine for unsafe records,
// duplicate phone detection, and QA reporting.

import { db } from "./powerdialer-db";
import type {
  V9Contact,
  QueueItem,
  Campaign,
  ImportReport,
  V9Tier,
  CallAttempt,
} from "./powerdialer-types";

// ── Deterministic ID ──
// Full concatenation (no hash collision risk with 29K records).
// Uses normalizePhone so the same contact gets the same ID even if
// the raw phone format changes between CSV exports (e.g. "5551234567"
// vs "+15551234567").
function makeContactId(row: {
  email: string;
  phone: string;
  full_name: string;
}): string {
  return [
    (row.email || "").toLowerCase().trim(),
    normalizePhone(row.phone || ""),
    (row.full_name || "").toLowerCase().trim(),
  ].join("||");
}

// ── Quarantine checks ──
const QUARANTINE_PATTERNS: Array<{
  test: (row: Record<string, string>) => boolean;
  reason: string;
}> = [
  {
    // Email-as-display-name (e.g., "greg@modernelectric.co" as full_name)
    test: (r) =>
      r.full_name === r.email &&
      !r.full_name.includes("@modernelectric.co"),
    reason: "email_as_display_name",
  },
  {
    test: (r) => {
      const f = r.full_name.toLowerCase();
      return ["sis", "mom", "dad", "pops", "bro"].includes(f);
    },
    reason: "family_intimate_label",
  },
  {
    test: (r) => {
      const flags = (r.qa_flags || "").toLowerCase();
      return (
        flags.includes("email_as_display_name") &&
        flags.includes("sparse_contact_fields") &&
        flags.includes("single_source")
      );
    },
    reason: "qa_flags_low_quality",
  },
  {
    test: (r) => {
      const phone = (r.phone || "").replace(/[^\d+]/g, "");
      return !!r.phone && (phone.length < 10 || phone.length > 16);
    },
    reason: "invalid_phone_length",
  },
];

function normalizeTier(raw: string): V9Tier | null {
  const t = (raw || "").toLowerCase().trim();
  if (t === "inner_circle") return "inner_circle";
  if (t === "close") return "close";
  if (t === "warm") return "warm";
  if (t === "cold") return "cold";
  return null;
}

// ── CSV Parser ──
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
        // Field was fully quoted — emit without trimming
        fields.push(current);
        current = "";
        fieldWasQuoted = false;
        // Consume trailing whitespace and comma after closing quote
        while (line[i + 1] === " ") i++;
        if (line[i + 1] === ",") i++;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        fieldWasQuoted = true;
      } else if (ch === ",") {
        fields.push(fieldWasQuoted ? current : current.trim());
        current = "";
        fieldWasQuoted = false;
      } else {
        current += ch;
      }
    }
  }
  // Only push the final field if it has content or was explicitly quoted (RFC 4180)
  if (current !== "" || fieldWasQuoted) {
    fields.push(fieldWasQuoted ? current : current.trim());
  }
  return fields;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    // Skip header-misalignment rows
    if (row["tier"] === "tier") continue;
    rows.push(row);
  }

  return { headers, rows };
}

// ── Phone normalization ──
function normalizePhone(raw: string): string {
  if (!raw) return "";
  let p = raw.replace(/[^\d+]/g, "");
  if (!p.startsWith("+") && p.length === 10) p = "+1" + p;
  if (!p.startsWith("+") && p.length === 11 && p.startsWith("1")) p = "+" + p;
  return p;
}

function parseNum(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ── Main Import ──

export interface ImportResult {
  report: ImportReport;
  contacts: V9Contact[];
  queueItems: QueueItem[];
  campaigns: Campaign[];
}

/**
 * Parse the canonical V9 Rolodex CSV (30 columns, ~30K rows).
 * Produces deterministic contact IDs, normalized tiers, E.164 phones,
 * quarantine flags, duplicate phone detection, and a QA report.
 * Returns contacts, queue items, campaigns, and the import report
 * for persistence via {@link persistImport}.
 */
export async function importV9CSV(text: string): Promise<ImportResult> {
  const { rows } = parseCSV(text);
  const importedAt = new Date().toISOString();

  const contacts: V9Contact[] = [];
  const rejectionReasons: Array<{ row: number; reason: string }> = [];
  const tierCounts: Record<V9Tier, number> = {
    inner_circle: 0,
    close: 0,
    warm: 0,
    cold: 0,
  };
  const quarantinedReasons: Record<string, number> = {};
  let callableCount = 0;
  let phoneCount = 0;
  let quarantinedCount = 0;

  let rowIndex = 0;
  for (const row of rows) {
    rowIndex++;
    const tier = normalizeTier(row["tier"]);

    if (!tier) {
      rejectionReasons.push({
        row: rowIndex,
        reason: `invalid_tier: "${row["tier"]?.slice(0, 40)}"`,
      });
      continue;
    }

    // Quarantine check
    let quarantined = false;
    let quarantineReason = "";
    for (const check of QUARANTINE_PATTERNS) {
      if (check.test(row)) {
        quarantined = true;
        quarantineReason = check.reason;
        break;
      }
    }

    const phone = normalizePhone(row["phone"] || "");
    const id = makeContactId({
      email: row["email"] || "",
      phone: row["phone"] || "",
      full_name: row["full_name"] || "",
    });

    const contact: V9Contact = {
      id,
      fullName: (row["full_name"] || "").trim(),
      email: (row["email"] || "").trim(),
      phone,
      company: (row["company"] || "").trim(),
      title: (row["title"] || "").trim(),
      headline: (row["headline"] || "").trim(),
      linkedinUrl: (row["linkedin_url"] || "").trim(),
      tier,
      engagementScore: parseNum(row["engagement_score"]),
      meetingsValidated: parseNum(row["meetings_validated"]),
      meetingsRaw: parseNum(row["meetings_raw"]),
      meetingConfidence: parseNum(row["meeting_confidence"]),
      granolaConfirmed: parseNum(row["granola_confirmed"]),
      emails: parseNum(row["emails"]),
      callsAnswered: parseNum(row["calls_answered"]),
      facetime: parseNum(row["facetime"]),
      texts: parseNum(row["texts"]),
      whatsapp: parseNum(row["whatsapp"]),
      introNodeCount: parseNum(row["intro_node_count"]),
      introNodes: row["intro_nodes"] || "",
      lastInteraction: row["last_interaction"] || "",
      notes: row["notes"] || "",
      location: row["location"] || "",
      industry: row["industry"] || "",
      companyWebsite: row["company_website"] || "",
      marketIntel: row["market_intel"] || "",
      godNodeSources: row["god_node_sources"] || "",
      sourceFiles: row["source_files"] || "",
      qaFlags: row["qa_flags"] || "",
      quarantined,
      quarantineReason,
    };

    tierCounts[tier]++;
    if (quarantined) {
      quarantinedCount++;
      quarantinedReasons[quarantineReason] =
        (quarantinedReasons[quarantineReason] || 0) + 1;
    }
    if (phone) phoneCount++;
    if (phone && !quarantined && tier !== "cold") callableCount++;

    contacts.push(contact);
  }

  // Duplicate phone detection
  const phoneMap = new Map<string, string[]>();
  for (const c of contacts) {
    if (!c.phone || c.quarantined) continue;
    const existing = phoneMap.get(c.phone) || [];
    existing.push(c.id);
    phoneMap.set(c.phone, existing);
  }
  const duplicatePhoneGroups: Array<{ phone: string; contacts: string[] }> = [];
  for (const [phone, ids] of phoneMap) {
    if (ids.length > 1) {
      duplicatePhoneGroups.push({ phone, contacts: ids });
    }
  }

  // ── Create campaigns ──
  const campaigns: Campaign[] = [
    {
      id: "v9_relationship_calls",
      name: "V9 Relationship Calls",
      sourceBoard: "PROJECT_PLANE_JANE_V9_POWER_DIALER_20260719.html",
      defaultTierOrder: ["inner_circle", "warm"],
      goal: "Call eligible Inner Circle first, then Warm. Close is optional filter.",
      scriptVersion: "GENERAL_RECONNECT_ONLY",
      createdAt: importedAt,
      status: "active",
    },
    // NOTE: This campaign is created for future use — queue items are not
    // auto-assigned here (all queue items go to v9_relationship_calls).
    // A manual "Assign to Verified Intro Node campaign" action can be added
    // to the queue manager or call screen later.
    {
      id: "verified_intro_node_calls",
      name: "Verified Intro Node Calls",
      sourceBoard: "PROJECT_PLANE_JANE_D2_POWER_DIALER_20260719.html",
      defaultTierOrder: ["inner_circle", "close"],
      goal: "36-connector investor-intro campaign. Separate from broad V9 queue.",
      scriptVersion: "INTRO_NODE_VERIFIED_ONLY",
      createdAt: importedAt,
      status: "active",
    },
  ];

  // ── Create queue items ──
  // Eligible: non-cold, non-quarantined, has phone.
  const eligible = contacts.filter(
    (c) => c.tier !== "cold" && !c.quarantined && c.phone,
  );

  // Sort: inner_circle first (by engagement_score desc), then warm, then close
  const tierPriority: Record<V9Tier, number> = {
    inner_circle: 0,
    close: 2,
    warm: 1,
    cold: 99,
  };

  eligible.sort((a, b) => {
    const ta = tierPriority[a.tier] ?? 99;
    const tb = tierPriority[b.tier] ?? 99;
    if (ta !== tb) return ta - tb;
    // Within same tier, higher engagement_score first, then meetings_validated
    if (b.engagementScore !== a.engagementScore)
      return b.engagementScore - a.engagementScore;
    return b.meetingsValidated - a.meetingsValidated;
  });

  const queueItems: QueueItem[] = eligible.map((c, i) => ({
    id: `qi-${c.id}`,
    campaignId: "v9_relationship_calls",
    contactId: c.id,
    priority: i,
    queueStatus: "queued" as const,
    suppressionReason: "",
    attemptCount: 0,
    nextCallAt: null,
    lastAttemptAt: null,
    manualOrder: i,
  }));

  const report: ImportReport = {
    campaignId: "v9_relationship_calls",
    totalRows: rows.length,
    tierCounts,
    callableCount,
    phoneCount,
    duplicatePhones: duplicatePhoneGroups.reduce(
      (sum, g) => sum + g.contacts.length - 1,
      0,
    ),
    duplicatePhoneGroups,
    quarantinedCount,
    quarantinedReasons,
    rejectedRows: rejectionReasons.length,
    rejectionReasons,
    importedAt,
  };

  return { report, contacts, queueItems, campaigns };
}

// ── Persist Import ──

/**
 * Write an import result to IndexedDB. Clears all prior data,
 * then batch-inserts contacts (500/tx), queue items, campaigns, and
 * the import report. Call after {@link importV9CSV}.
 */
export async function persistImport(result: ImportResult): Promise<void> {
  await db.clearCampaignData("v9_relationship_calls");
  await db.upsertContactsBatch(result.contacts);
  await db.upsertQueueItemsBatch(result.queueItems);
  for (const campaign of result.campaigns) {
    await db.saveCampaign(campaign);
  }
  await db.saveImportReport(result.report);
}

// ── Energy Contacts Import ──

/**
 * Import the energy contacts CSV (subset of A-Z call list).
 * Creates a separate "v9_energy_calls" campaign without touching
 * personal (v9_relationship_calls) data.
 * Only contacts WITH phone numbers get queue items (callable).
 */
export async function importEnergyCSV(text: string): Promise<ImportResult> {
  const { rows } = parseCSV(text);
  const importedAt = new Date().toISOString();

  const contacts: V9Contact[] = [];
  const rejectionReasons: Array<{ row: number; reason: string }> = [];
  const tierCounts: Record<V9Tier, number> = {
    inner_circle: 0,
    close: 0,
    warm: 0,
    cold: 0,
  };
  const quarantinedReasons: Record<string, number> = {};
  let callableCount = 0;
  let phoneCount = 0;
  let quarantinedCount = 0;

  let rowIndex = 0;
  for (const row of rows) {
    rowIndex++;
    const tier = normalizeTier(row["tier"]) || "warm"; // default warm for energy contacts

    const phone = normalizePhone(row["phone"] || "");
    const id = makeContactId({
      email: row["email"] || "",
      phone: row["phone"] || "",
      full_name: row["full_name"] || "",
    });

    const contact: V9Contact = {
      id,
      fullName: (row["full_name"] || "").trim(),
      email: (row["email"] || "").trim(),
      phone,
      company: (row["company"] || "").trim(),
      title: (row["title"] || "").trim(),
      headline: (row["headline"] || "").trim(),
      linkedinUrl: (row["linkedin_url"] || "").trim(),
      tier,
      engagementScore: parseNum(row["engagement_score"]),
      meetingsValidated: parseNum(row["meetings_validated"]),
      meetingsRaw: parseNum(row["meetings_raw"]),
      meetingConfidence: parseNum(row["meeting_confidence"]),
      granolaConfirmed: parseNum(row["granola_confirmed"]),
      emails: parseNum(row["emails"]),
      callsAnswered: parseNum(row["calls_answered"]),
      facetime: parseNum(row["facetime"]),
      texts: parseNum(row["texts"]),
      whatsapp: parseNum(row["whatsapp"]),
      introNodeCount: parseNum(row["intro_node_count"]),
      introNodes: row["intro_nodes"] || "",
      lastInteraction: row["last_interaction"] || "",
      notes: row["notes"] || "",
      location: row["location"] || "",
      industry: row["industry"] || "",
      companyWebsite: row["company_website"] || "",
      marketIntel: row["market_intel"] || "",
      godNodeSources: row["god_node_sources"] || "",
      sourceFiles: row["source_files"] || "",
      qaFlags: row["qa_flags"] || "",
      quarantined: false,
      quarantineReason: "",
    };

    tierCounts[tier]++;
    if (phone) phoneCount++;
    if (phone && tier !== "cold") callableCount++;

    contacts.push(contact);
  }

  // Campaign
  const campaign: Campaign = {
    id: "v9_energy_calls",
    name: "Energy Contacts",
    sourceBoard: "AZ_CALL_LIST_20260731",
    defaultTierOrder: ["inner_circle", "close", "warm"],
    goal: "Power-dial energy-sector contacts from A-Z call list.",
    scriptVersion: "ENERGY_SECTOR",
    createdAt: importedAt,
    status: "active",
  };

  // Queue items — only for contacts with phone numbers (non-cold)
  const eligible = contacts.filter(
    (c) => c.tier !== "cold" && c.phone,
  );

  const tierPriority: Record<string, number> = {
    inner_circle: 0,
    close: 1,
    warm: 2,
    cold: 99,
  };

  eligible.sort((a, b) => {
    const ta = tierPriority[a.tier] ?? 99;
    const tb = tierPriority[b.tier] ?? 99;
    if (ta !== tb) return ta - tb;
    if (b.engagementScore !== a.engagementScore)
      return b.engagementScore - a.engagementScore;
    return b.meetingsValidated - a.meetingsValidated;
  });

  const queueItems: QueueItem[] = eligible.map((c, i) => ({
    id: `qi-energy-${c.id}`,
    campaignId: "v9_energy_calls",
    contactId: c.id,
    priority: i,
    queueStatus: "queued" as const,
    suppressionReason: "",
    attemptCount: 0,
    nextCallAt: null,
    lastAttemptAt: null,
    manualOrder: i,
  }));

  const report: ImportReport = {
    campaignId: "v9_energy_calls",
    totalRows: rows.length,
    tierCounts,
    callableCount,
    phoneCount,
    duplicatePhones: 0,
    duplicatePhoneGroups: [],
    quarantinedCount,
    quarantinedReasons,
    rejectedRows: rejectionReasons.length,
    rejectionReasons,
    importedAt,
  };

  return { report, contacts, queueItems, campaigns: [campaign] };
}

/**
 * Persist an energy import result alongside existing personal data.
 * Clears only the energy campaign's queue items and call attempts,
 * then upserts contacts, queue items, campaign, and report.
 */
export async function persistEnergyImport(result: ImportResult): Promise<void> {
  await db.clearCampaignData("v9_energy_calls");
  await db.upsertContactsBatch(result.contacts);
  await db.upsertQueueItemsBatch(result.queueItems);
  for (const campaign of result.campaigns) {
    await db.saveCampaign(campaign);
  }
  await db.saveImportReport(result.report);
}

// ── Export Helpers ──

/**
 * Export all call attempts as PROJECT_PLANE_JANE_POWERDIALER_CALL_LOG CSV
 * with the documented 22-column schema. Joins contact and campaign data,
 * and numbers attempts per contact chronologically.
 */
export function exportCallLogCSV(
  attempts: CallAttempt[],
  contacts: V9Contact[],
  campaigns: Campaign[],
): string {
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  const headers = [
    "attempt_id", "logged_at", "called_by", "campaign_id", "source_board",
    "contact_id", "contact_name", "tier", "email", "phone_e164",
    "company", "title", "attempt_number", "channel", "outcome",
    "next_step", "next_step_due", "commitment_status", "commitment_details",
    "notes", "evidence_reference",
  ];

  function esc(v: string | number | null | undefined): string {
    if (v == null || v === "") return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const lines: string[] = [headers.join(",")];

  // Group attempts by contact for numbering
  const attemptsByContact = new Map<string, CallAttempt[]>();
  for (const a of attempts) {
    const list = attemptsByContact.get(a.contactId);
    if (list) list.push(a);
    else attemptsByContact.set(a.contactId, [a]);
  }

  // Pre-sort and compute attempt numbers per contact group once (avoid O(n² log n))
  const attemptNumMap = new Map<string, number>();
  for (const [contactId, contactAttempts] of attemptsByContact) {
    const sorted = [...contactAttempts].sort(
      (x, y) =>
        new Date(x.initiatedAt).getTime() - new Date(y.initiatedAt).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      attemptNumMap.set(sorted[i].id, i + 1);
    }
  }

  for (const a of attempts) {
    const c = contactMap.get(a.contactId);
    const cam = campaignMap.get(a.campaignId);
    const attemptNum = attemptNumMap.get(a.id) ?? 1;

    lines.push([
      esc(a.id), esc(a.loggedAt || a.initiatedAt), esc(a.calledBy),
      esc(a.campaignId), esc(cam?.sourceBoard || ""),
      esc(a.contactId), esc(c?.fullName || ""), esc(c?.tier || ""),
      esc(c?.email || ""), esc(a.phoneUsed),
      esc(c?.company || ""), esc(c?.title || ""), String(attemptNum),
      esc(a.channel), esc(a.outcome || ""),
      esc(a.nextStep), esc(a.nextStepDue || ""),
      esc(a.commitmentStatus), esc(a.commitmentDetails),
      esc(a.notes), esc(a.evidenceReference),
    ].join(","));
  }
  return lines.join("\n");
}

/**
 * Export all call attempts as enriched JSON with full contact and campaign
 * data joined in. Suitable for programmatic processing.
 */
export function exportCallLogJSON(
  attempts: CallAttempt[],
  contacts: V9Contact[],
): string {
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  return JSON.stringify(
    attempts.map((a) => {
      const c = contactMap.get(a.contactId);
      return { ...a, contact_name: c?.fullName ?? "", contact_tier: c?.tier ?? "", contact_email: c?.email ?? "", contact_company: c?.company ?? "" };
    }),
    null,
    2,
  );
}

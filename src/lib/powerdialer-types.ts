// ── Powerdialer Data Types ──
// Deterministic contact IDs, append-only call logs, campaign separation.

export type V9Tier = "inner_circle" | "close" | "warm" | "cold";

export interface V9Contact {
  /** Deterministic ID from (email||phone||full_name_lower). Stable across re-imports. */
  id: string;
  fullName: string;
  email: string;
  /** E.164 phone, empty if none. */
  phone: string;
  company: string;
  title: string;
  headline: string;
  linkedinUrl: string;
  /** Canonical tier as found in the V9 CSV. */
  tier: V9Tier;
  engagementScore: number;
  meetingsValidated: number;
  meetingsRaw: number;
  meetingConfidence: number;
  granolaConfirmed: number;
  emails: number;
  callsAnswered: number;
  facetime: number;
  texts: number;
  whatsapp: number;
  introNodeCount: number;
  introNodes: string;
  lastInteraction: string;
  notes: string;
  location: string;
  industry: string;
  companyWebsite: string;
  marketIntel: string;
  godNodeSources: string;
  sourceFiles: string;
  qaFlags: string;
  /** If true, this record was flagged for quarantine (self, system, family, etc.) */
  quarantined: boolean;
  quarantineReason: string;
}

export type QueueStatus =
  | "queued"
  | "initiated_unconfirmed"
  | "outcome_required"
  | "attempted"
  | "completed"
  | "suppressed";

export interface QueueItem {
  id: string;
  campaignId: string;
  contactId: string;
  /** Lower = higher priority. Computed from tier + value_score + engagement. */
  priority: number;
  queueStatus: QueueStatus;
  suppressionReason: string;
  attemptCount: number;
  nextCallAt: string | null;
  lastAttemptAt: string | null;
  manualOrder: number;
}

export type CallOutcome =
  | "no_answer"
  | "left_voicemail"
  | "connected"
  | "callback_requested"
  | "text_requested"
  | "email_requested"
  | "intro_offered"
  | "intro_made"
  | "declined"
  | "wrong_number"
  | "do_not_call"
  | "duplicate"
  | "skip_for_now";

export type CommitmentStatus =
  | "not_discussed"
  | "no"
  | "soft_yes"
  | "yes"
  | "needs_follow_up";

export type CallChannel = "facetime_audio" | "phone";

export interface CallAttempt {
  id: string;
  queueItemId: string;
  contactId: string;
  campaignId: string;
  initiatedAt: string;
  loggedAt: string | null;
  calledBy: string;
  channel: CallChannel;
  phoneUsed: string;
  outcome: CallOutcome | null;
  notes: string;
  nextStep: string;
  nextStepDue: string | null;
  commitmentStatus: CommitmentStatus;
  commitmentDetails: string;
  evidenceReference: string;
}

export interface Campaign {
  id: string;
  name: string;
  sourceBoard: string;
  /** Ordered tier list for the default queue. */
  defaultTierOrder: V9Tier[];
  goal: string;
  scriptVersion: string;
  createdAt: string;
  status: "active" | "paused" | "completed";
}

export interface ImportReport {
  totalRows: number;
  tierCounts: Record<V9Tier, number>;
  callableCount: number;
  phoneCount: number;
  duplicatePhones: number;
  duplicatePhoneGroups: Array<{ phone: string; contacts: string[] }>;
  quarantinedCount: number;
  quarantinedReasons: Record<string, number>;
  rejectedRows: number;
  rejectionReasons: Array<{ row: number; reason: string }>;
  importedAt: string;
}

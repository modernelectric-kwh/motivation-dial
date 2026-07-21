import { type Contact } from "./vcf";

const KEYS = {
  contacts: "mc.contacts",
  companyMd: "mc.companyMd",
  notionDb: "mc.notionDbUrl",
  motivation: "mc.motivation",
  queueIdx: "mc.queueIdx",
  history: "mc.history",
  chatgpt: "mc.chatgpt",
  claude: "mc.claude",
  perplexity: "mc.perplexity",
  vmScript: "mc.vmScript",
  dnc: "mc.dnc",
  tags: "mc.tags",
  followupTemplate: "mc.followupTemplate",
  calCom: "mc.calCom",
} as const;

export interface CallLog {
  contactId: string;
  contactName: string;
  at: string;
  outcome: "connected" | "no-answer" | "voicemail-dropped" | "voicemail" | "callback" | "not-interested" | "wrong-number" | "skipped";
  notes: string;
}

export interface ChatContext {
  source: "chatgpt" | "claude" | "perplexity";
  updatedAt: string;
  entryCount: number;
  digest: string; // condensed searchable summary
}

const isBrowser = () => typeof window !== "undefined";

function get<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function set<T>(key: string, value: T) {
  if (!isBrowser()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

export const store = {
  getContacts: (): Contact[] => get(KEYS.contacts, []),
  setContacts: (c: Contact[]) => set(KEYS.contacts, c),
  getCompanyMd: (): string => get(KEYS.companyMd, ""),
  setCompanyMd: (s: string) => set(KEYS.companyMd, s),
  getNotionDb: (): string => get(KEYS.notionDb, ""),
  setNotionDb: (s: string) => set(KEYS.notionDb, s),
  getMotivation: (): string =>
    get(
      KEYS.motivation,
      `You win because the problem matters — energy reliability, families forced to choose between power and medicine. Not to be finally loved. Ride mission, not verdict. Gold or silver — no ninth place. Build free. Protect your people.`,
    ),
  setMotivation: (s: string) => set(KEYS.motivation, s),
  getQueueIdx: (): number => get(KEYS.queueIdx, 0),
  setQueueIdx: (n: number) => set(KEYS.queueIdx, n),
  getHistory: (): CallLog[] => get(KEYS.history, []),
  addLog: (log: CallLog) => set(KEYS.history, [log, ...get<CallLog[]>(KEYS.history, [])]),
  historyFor: (contactId: string) =>
    get<CallLog[]>(KEYS.history, []).filter((l) => l.contactId === contactId),
  // Chat context ingestion
  getChatgpt: (): ChatContext | null => get<ChatContext | null>(KEYS.chatgpt, null),
  setChatgpt: (c: ChatContext | null) => set(KEYS.chatgpt, c),
  getClaude: (): ChatContext | null => get<ChatContext | null>(KEYS.claude, null),
  setClaude: (c: ChatContext | null) => set(KEYS.claude, c),
  getPerplexity: (): ChatContext | null => get<ChatContext | null>(KEYS.perplexity, null),
  setPerplexity: (c: ChatContext | null) => set(KEYS.perplexity, c),
  // Voicemail drop script
  getVmScript: (): string =>
    get(KEYS.vmScript, "Hey — Chino here. Missed you. Sending a placeholder for tomorrow; grab it or decline, no pressure. Talk soon."),
  setVmScript: (s: string) => set(KEYS.vmScript, s),
  // DNC list
  getDNC: (): string[] => get<string[]>(KEYS.dnc, []),
  addDNC: (phone: string) => {
    const list = get<string[]>(KEYS.dnc, []);
    if (!list.includes(phone)) set(KEYS.dnc, [phone, ...list]);
  },
  removeDNC: (phone: string) => set(KEYS.dnc, get<string[]>(KEYS.dnc, []).filter((p) => p !== phone)),
  // Contact tags
  getTags: (): Record<string, string[]> => get(KEYS.tags, {}),
  setTagsFor: (id: string, tags: string[]) => {
    const all = get<Record<string, string[]>>(KEYS.tags, {});
    all[id] = tags;
    set(KEYS.tags, all);
  },
  // Follow-up email template
  getFollowupTemplate: (): string =>
    get(
      KEYS.followupTemplate,
      `Hey {{first}},\n\nGreat catching up. Quick recap of what we covered — and a next step so we don't lose momentum.\n\n— Chino`,
    ),
  setFollowupTemplate: (s: string) => set(KEYS.followupTemplate, s),
  // Cal.com link
  getCalCom: (): string => get(KEYS.calCom, "https://cal.com/chinolex/call"),
  setCalCom: (s: string) => set(KEYS.calCom, s),
};
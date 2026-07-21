import { type Contact } from "./vcf";

const KEYS = {
  contacts: "mc.contacts",
  companyMd: "mc.companyMd",
  notionDb: "mc.notionDbUrl",
  motivation: "mc.motivation",
  queueIdx: "mc.queueIdx",
  history: "mc.history",
} as const;

export interface CallLog {
  contactId: string;
  contactName: string;
  at: string;
  outcome: "connected" | "no-answer" | "voicemail" | "skipped";
  notes: string;
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
};
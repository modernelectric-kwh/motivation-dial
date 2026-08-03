// ── Powerdialer IndexedDB Store ──
// Handles 25K+ contacts without localStorage overflow.
// Separate stores: contacts, queue_items, call_attempts, campaigns, import_reports.

import type {
  V9Contact,
  QueueItem,
  CallAttempt,
  Campaign,
  ImportReport,
  V9Tier,
} from "./powerdialer-types";

const DB_NAME = "powerdialer-v9";
const DB_VERSION = 1;

const STORES = {
  contacts: "contacts",
  queueItems: "queue_items",
  callAttempts: "call_attempts",
  campaigns: "campaigns",
  importReports: "import_reports",
} as const;

// ── DB Helpers ──

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // contacts store — keyed by deterministic id
      if (!db.objectStoreNames.contains(STORES.contacts)) {
        const contactsStore = db.createObjectStore(STORES.contacts, { keyPath: "id" });
        contactsStore.createIndex("tier", "tier", { unique: false });
        contactsStore.createIndex("phone", "phone", { unique: false });
        contactsStore.createIndex("engagementScore", "engagementScore", { unique: false });
      }
      // queue_items — keyed by id
      if (!db.objectStoreNames.contains(STORES.queueItems)) {
        const qiStore = db.createObjectStore(STORES.queueItems, { keyPath: "id" });
        qiStore.createIndex("campaignId", "campaignId", { unique: false });
        qiStore.createIndex("contactId", "contactId", { unique: false });
        qiStore.createIndex("queueStatus", "queueStatus", { unique: false });
        qiStore.createIndex("priority", "priority", { unique: false });
      }
      // call_attempts — keyed by id
      if (!db.objectStoreNames.contains(STORES.callAttempts)) {
        const caStore = db.createObjectStore(STORES.callAttempts, { keyPath: "id" });
        caStore.createIndex("contactId", "contactId", { unique: false });
        caStore.createIndex("campaignId", "campaignId", { unique: false });
        caStore.createIndex("queueItemId", "queueItemId", { unique: false });
        caStore.createIndex("initiatedAt", "initiatedAt", { unique: false });
      }
      // campaigns
      if (!db.objectStoreNames.contains(STORES.campaigns)) {
        db.createObjectStore(STORES.campaigns, { keyPath: "id" });
      }
      // import_reports
      if (!db.objectStoreNames.contains(STORES.importReports)) {
        db.createObjectStore(STORES.importReports, { keyPath: "importedAt" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // Allow retry on next call
      reject(req.error);
    };
  });
  return dbPromise;
}

function closeDB() {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => {});
    dbPromise = null;
  }
}

// ── Generic CRUD ──

async function putAll<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putOne<T>(storeName: string, item: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function getOne<T>(storeName: string, id: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function getByIndex<T>(
  storeName: string,
  indexName: string,
  value: string | number,
): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function count(storeName: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * V9 Powerdialer IndexedDB interface.
 * Database: `powerdialer-v9`, version 1.
 * Stores: contacts, queueItems, callAttempts, campaigns, importReports.
 * All writes are single-store puts; batch imports use replaceContact/QueueItem
 * which wrapper multiple 500-record transactions.
 */
export const db = {
  // ── Import / Reset ──
  async replaceContacts(contacts: V9Contact[]): Promise<void> {
    await clearStore(STORES.contacts);
    // Chunk into batches for IndexedDB performance
    const BATCH = 500;
    for (let i = 0; i < contacts.length; i += BATCH) {
      await putAll(STORES.contacts, contacts.slice(i, i + BATCH));
    }
  },

  async replaceQueueItems(items: QueueItem[]): Promise<void> {
    await clearStore(STORES.queueItems);
    const BATCH = 500;
    for (let i = 0; i < items.length; i += BATCH) {
      await putAll(STORES.queueItems, items.slice(i, i + BATCH));
    }
  },

  async clearAllData(): Promise<void> {
    for (const store of Object.values(STORES)) {
      await clearStore(store);
    }
  },

  /** Clear queue items and call attempts for a single campaign without touching other data. */
  async clearCampaignData(campaignId: string): Promise<void> {
    const db = await openDB();
    // Clear queue items for this campaign
    const qiTx = db.transaction(STORES.queueItems, "readwrite");
    const qiStore = qiTx.objectStore(STORES.queueItems);
    const qiIndex = qiStore.index("campaignId");
    const qiReq = qiIndex.getAllKeys(campaignId);
    await new Promise<void>((resolve, reject) => {
      qiReq.onsuccess = () => {
        for (const key of qiReq.result) qiStore.delete(key);
      };
      qiTx.oncomplete = () => resolve();
      qiTx.onerror = () => reject(qiTx.error);
    });

    // Clear call attempts for this campaign
    const caTx = db.transaction(STORES.callAttempts, "readwrite");
    const caStore = caTx.objectStore(STORES.callAttempts);
    const caIndex = caStore.index("campaignId");
    const caReq = caIndex.getAllKeys(campaignId);
    await new Promise<void>((resolve, reject) => {
      caReq.onsuccess = () => {
        for (const key of caReq.result) caStore.delete(key);
      };
      caTx.oncomplete = () => resolve();
      caTx.onerror = () => reject(caTx.error);
    });
  },

  /** Filter queue items eligible for dialing in a campaign:
   *  not suppressed/completed/attempted, and past any cooldown. */
  async filterEligibleQueueItems(
    campaignId: string,
    now: string = new Date().toISOString(),
  ): Promise<QueueItem[]> {
    const items = await this.getAllQueueItems();
    return items
      .filter(
        (qi) =>
          qi.campaignId === campaignId &&
          qi.queueStatus !== "suppressed" &&
          qi.queueStatus !== "completed" &&
          qi.queueStatus !== "attempted" &&
          (!qi.nextCallAt || qi.nextCallAt <= now),
      )
      .sort((a, b) => a.priority - b.priority);
  },

  /** Upsert a batch of contacts without clearing existing data.
   *  Merges with existing contact data to avoid overwriting richer fields
   *  (e.g. personal CSV company/title) with empty strings from energy CSV. */
  async upsertContactsBatch(contacts: V9Contact[]): Promise<void> {
    const db = await openDB();
    // Build map of existing contacts that share IDs with the incoming batch
    const existingMap = new Map<string, V9Contact>();
    const ids = contacts.map((c) => c.id);
    const MERGE_FIELDS = ["company", "title", "headline", "linkedinUrl", "location", "industry", "notes"] as const;
    // Read existing contacts in chunks for IndexedDB efficiency
    const READ_BATCH = 200;
    for (let i = 0; i < ids.length; i += READ_BATCH) {
      const chunk = ids.slice(i, i + READ_BATCH);
      const tx = db.transaction(STORES.contacts, "readonly");
      const store = tx.objectStore(STORES.contacts);
      const results = await Promise.all(
        chunk.map((id) =>
          new Promise<V9Contact | undefined>((resolve) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          }),
        ),
      );
      for (const r of results) {
        if (r) existingMap.set(r.id, r);
      }
    }

    // Write with merging — preserve non-empty existing fields
    const BATCH = 500;
    for (let i = 0; i < contacts.length; i += BATCH) {
      const batch = contacts.slice(i, i + BATCH);
      const tx = db.transaction(STORES.contacts, "readwrite");
      const store = tx.objectStore(STORES.contacts);
      for (const contact of batch) {
        const existing = existingMap.get(contact.id);
        if (existing) {
          const merged = { ...contact } as V9Contact & Record<string, string>;
          for (const f of MERGE_FIELDS) {
            merged[f] = (contact as any)[f] || (existing as any)[f];
          }
          store.put(merged);
        } else {
          store.put(contact);
        }
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  },

  /** Upsert a batch of queue items without clearing. */
  async upsertQueueItemsBatch(items: QueueItem[]): Promise<void> {
    const BATCH = 500;
    for (let i = 0; i < items.length; i += BATCH) {
      await putAll(STORES.queueItems, items.slice(i, i + BATCH));
    }
  },

  // ── Contacts ──
  getContact: (id: string) => getOne<V9Contact>(STORES.contacts, id),
  getAllContacts: () => getAll<V9Contact>(STORES.contacts),
  updateContact: (contact: V9Contact) => putOne(STORES.contacts, contact),
  getContactsByTier: (tier: V9Tier) =>
    getByIndex<V9Contact>(STORES.contacts, "tier", tier),
  getContactsByPhone: (phone: string) =>
    getByIndex<V9Contact>(STORES.contacts, "phone", phone),
  contactCount: () => count(STORES.contacts),

  // ── Queue Items ──
  getQueueItem: (id: string) => getOne<QueueItem>(STORES.queueItems, id),
  getAllQueueItems: () => getAll<QueueItem>(STORES.queueItems),
  getQueueItemsByCampaign: (campaignId: string) =>
    getByIndex<QueueItem>(STORES.queueItems, "campaignId", campaignId),
  getQueueItemByContact: (contactId: string) =>
    getByIndex<QueueItem>(STORES.queueItems, "contactId", contactId),
  updateQueueItem: (item: QueueItem) => putOne(STORES.queueItems, item),
  queueItemCount: () => count(STORES.queueItems),

  // ── Call Attempts ──
  getCallAttempt: (id: string) => getOne<CallAttempt>(STORES.callAttempts, id),
  getAllCallAttempts: () => getAll<CallAttempt>(STORES.callAttempts),
  getAttemptsByContact: (contactId: string) =>
    getByIndex<CallAttempt>(STORES.callAttempts, "contactId", contactId),
  getAttemptsByCampaign: (campaignId: string) =>
    getByIndex<CallAttempt>(STORES.callAttempts, "campaignId", campaignId),
  addCallAttempt: (attempt: CallAttempt) => putOne(STORES.callAttempts, attempt),
  updateCallAttempt: (attempt: CallAttempt) => putOne(STORES.callAttempts, attempt),
  callAttemptCount: () => count(STORES.callAttempts),

  // ── Campaigns ──
  getCampaign: (id: string) => getOne<Campaign>(STORES.campaigns, id),
  getAllCampaigns: () => getAll<Campaign>(STORES.campaigns),
  saveCampaign: (campaign: Campaign) => putOne(STORES.campaigns, campaign),
  campaignCount: () => count(STORES.campaigns),

  // ── Import Reports ──
  getLatestImportReport: async (): Promise<ImportReport | undefined> => {
    const reports = await getAll<ImportReport>(STORES.importReports);
    if (reports.length === 0) return undefined;
    return reports.sort(
      (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
    )[0];
  },
  /** Get the latest import report for a specific campaign. */
  getLatestImportReportForCampaign: async (campaignId: string): Promise<ImportReport | undefined> => {
    const reports = await getAll<ImportReport>(STORES.importReports);
    const campaignReports = reports.filter((r) => r.campaignId === campaignId);
    if (campaignReports.length === 0) return undefined;
    return campaignReports.sort(
      (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
    )[0];
  },
  saveImportReport: (report: ImportReport) => putOne(STORES.importReports, report),

  // ── Lifecycle ──
  close: () => closeDB(),
};

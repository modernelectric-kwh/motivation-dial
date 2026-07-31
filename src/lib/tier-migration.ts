/**
 * One-time migration: bump Granola-confirmed contacts from "cold" to "warm" (or "close").
 * Runs once on app load — creates a marker in localStorage so it never re-runs.
 */

import { db } from "./powerdialer-db";
import type { V9Tier } from "./powerdialer-types";

const MIGRATION_KEY = "v9.tier-migration-granola-2026-07-31";

// Contacts to bump: tier assignments based on Granola meeting evidence
const TIER_UPDATES: Array<{ namePattern: string; newTier: V9Tier }> = [
  { namePattern: "Adam Bohe", newTier: "close" },
  { namePattern: "Carolin Funk", newTier: "warm" },
  { namePattern: "Casey Erisman", newTier: "warm" },
  { namePattern: "Denis Muratov", newTier: "warm" },
  { namePattern: "Egil Rosten", newTier: "warm" },
  { namePattern: "Erik Roth", newTier: "warm" },
  { namePattern: "Fred Purches", newTier: "warm" },
  { namePattern: "Greg Gernetzke", newTier: "warm" },
  { namePattern: "Jason Edrington", newTier: "warm" },
  { namePattern: "Jason Renon", newTier: "warm" },
  { namePattern: "Jesus Prieto", newTier: "warm" },
  { namePattern: "Kevin Garden", newTier: "warm" },
  { namePattern: "Mark O'Keefe", newTier: "warm" },
  { namePattern: "McGee Young", newTier: "warm" },
  { namePattern: "Rebecca Kujawa", newTier: "warm" },
  { namePattern: "Todd Forgione", newTier: "warm" },
];

// Tier → default priority (matches import logic)
const TIER_PRIORITY: Record<V9Tier, number> = {
  inner_circle: 0,
  warm: 1,
  close: 2,
  cold: 99,
};

export async function runTierMigration(): Promise<number> {
  if (typeof window === "undefined") return 0;
  if (localStorage.getItem(MIGRATION_KEY)) return 0;

  let updated = 0;
  const allContacts = await db.getAllContacts();
  const allQueueItems = await db.getAllQueueItems();

  for (const contact of allContacts) {
    if (contact.tier !== "cold") continue;
    const match = TIER_UPDATES.find((u) =>
      contact.fullName.toLowerCase().includes(u.namePattern.toLowerCase()),
    );
    if (!match) continue;

    // Update contact tier
    const oldTier = contact.tier;
    contact.tier = match.newTier;
    await db.updateContact(contact);
    updated++;

    // Update queue items for this contact to match new tier priority
    const newPriority = TIER_PRIORITY[match.newTier];
    const contactQI = allQueueItems.filter((qi) => qi.contactId === contact.id);
    for (const qi of contactQI) {
      qi.priority = newPriority;
      await db.updateQueueItem(qi);
    }

    console.log(
      `[tier-migration] ${contact.fullName}: ${oldTier} → ${match.newTier} (priority: ${newPriority})`,
    );
  }

  localStorage.setItem(MIGRATION_KEY, "done");
  return updated;
}

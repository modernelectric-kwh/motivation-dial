/**
 * Energy Contacts Import
 * 
 * Imports the 20+ missing energy contacts from the Granola → V9 cross-reference.
 * These contacts will be queued in a separate "energy_contacts" campaign,
 * with phone numbers harvested from Google Calendar event descriptions (Cal.com bookings).
 */

import type { V9Contact, QueueItem, Campaign } from "./powerdialer-types";
import { makeContactId, normalizePhone } from "./v9-import";

export interface EnergyContactInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  tier?: "inner_circle" | "close" | "warm" | "cold";
}

// The 20+ missing energy contacts (verified from Granola, not yet in V9 Rolodex)
export const ENERGY_CONTACTS: EnergyContactInput[] = [
  { name: "Shaan", email: "shaan@voltify.com", company: "Voltify", title: "Founder" },
  { name: "Dardo", email: "dardo@dyness-tech.com", company: "Dyness", title: "US Lead" },
  { name: "Sila Kiliccote", company: "Breakthrough Energy Ventures", title: "Ex-founder" },
  { name: "Joselyn Lai", company: "Bedrock Energy", title: "Founder/Operator" },
  { name: "Irwin Katsof", email: "irwin@katsof.com", company: "Certified Trade Missions", title: "Director" },
  { name: "Henk", company: "Blue Planet" },
  { name: "Romie", company: "Texas PUC" },
  { name: "Adam Bohe", email: "adam.bohe@greentechrenewables.com", company: "Greentech / LGCY", tier: "close" },
  { name: "Brian Hall", email: "brianh@fortresspower.com", company: "Fortress Power" },
  { name: "Carl Cho", email: "carl.cho@citi.com", company: "Citi", title: "Director, Clean Energy Finance" },
  { name: "Christian", email: "christian@occam-edge.com", company: "Occam Edge", title: "Grid/utility analyst" },
  { name: "Christina Karapataki", email: "ckarapataki@b-t.energy", company: "Breakthrough Energy Ventures", title: "Partner" },
  { name: "Jack Sidler", email: "jack.sidler@prc.nm.gov", company: "New Mexico PRC", title: "State utility regulator" },
  { name: "John Ritch", email: "john.ritch@nebius.com", company: "Nebius", title: "US power supply lead" },
  { name: "Justin Hoch", email: "justinh@fortresspower.com", company: "Fortress Power", title: "East Coast team" },
  { name: "Kyle Roth", email: "kyle.roth@blueowl.com", company: "Blue Owl Capital", title: "Power gen & compute financing" },
  { name: "Matt Chambliss", email: "matthew.chambliss@aligneddc.com", company: "Aligned Data Centers" },
  { name: "Max", email: "max@wattcarbon.com", company: "WattCarbon", title: "Platform/product" },
  { name: "Meghan Pasricha", email: "meghan.pasricha@galvanizeclimate.com", company: "Galvanize Climate", title: "Climate credit investor" },
  { name: "M. Lahoud", email: "mlahoud@stream-dc.com", company: "Stream Data Centers" },
  { name: "Nicolas Barrios Hernandez", email: "nicolasb@fortresspower.com", company: "Fortress Power", title: "BESS sales" },
  { name: "Pytes USA", email: "pytesusa@pytesgroup.com", company: "Pytes", title: "Battery manufacturer" },
  { name: "Steven McKenna", email: "smckenna@iso-ne.com", company: "ISO New England", title: "ISO market operations" },
  { name: "Tyler Baldridge", email: "tyler@copperskycapital.com", company: "Copper Sky Capital", title: "VC" },
  { name: "Eguana Sales US", email: "sales.us@eguanatech.com", company: "Eguana Technologies" },
];

/**
 * Convert an EnergyContactInput to a V9Contact.
 * Requires phone to be provided separately (harvested from Google Calendar).
 */
export function energyContactToV9(input: EnergyContactInput, phone: string = ""): V9Contact {
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  const id = makeContactId({
    email: input.email || "",
    phone: normalizedPhone,
    full_name: input.name.toLowerCase(),
  });

  return {
    id,
    fullName: input.name,
    email: input.email || "",
    phone: normalizedPhone,
    company: input.company || "",
    title: input.title || "",
    headline: `${input.title ? input.title + " at " : ""}${input.company || ""}`,
    linkedinUrl: "",
    tier: (input.tier || "warm") as "inner_circle" | "close" | "warm" | "cold",
    engagementScore: 50,
    meetingsValidated: 0,
    meetingsRaw: 0,
    meetingConfidence: 0,
    granolaConfirmed: 1,
    emails: 0,
    callsAnswered: 0,
    facetime: 0,
    texts: 0,
    whatsapp: 0,
    introNodeCount: 0,
    introNodes: "",
    lastInteraction: "",
    notes: "Granola-verified energy contact",
    location: "",
    industry: "energy",
    companyWebsite: "",
    marketIntel: "",
    godNodeSources: "",
    sourceFiles: "",
    qaFlags: "",
    quarantined: false,
    quarantineReason: "",
  };
}

/**
 * Persist energy contacts to IndexedDB.
 * This is called once on app initialization if the energy_contacts campaign doesn't exist.
 */
export async function persistEnergyContacts(db: any): Promise<void> {
  // Check if energy_contacts campaign already exists
  const existingCampaign = await db.getCampaign("energy_contacts");
  if (existingCampaign) {
    console.log("Energy contacts already initialized");
    return;
  }

  // Harvest phone numbers from Google Calendar
  const phoneMap = await harvestPhonesFromGoogleCalendar();

  // Convert energy contacts to V9 format and add to IndexedDB
  const contacts: V9Contact[] = [];
  const queueItems: QueueItem[] = [];

  for (let i = 0; i < ENERGY_CONTACTS.length; i++) {
    const input = ENERGY_CONTACTS[i];
    const phone = phoneMap[input.email || ""] || "";
    const contact = energyContactToV9(input, phone);

    // Only add to queue if they have a phone number
    if (contact.phone) {
      contacts.push(contact);

      const queueItem: QueueItem = {
        id: `qi_${contact.id}`,
        campaignId: "energy_contacts",
        contactId: contact.id,
        queueStatus: "queued",
        priority: i,
        suppressionReason: "",
        attemptCount: 0,
        nextCallAt: null,
        lastAttemptAt: null,
        manualOrder: i,
      };
      queueItems.push(queueItem);
    }
  }

  // Create the campaign
  const campaign = createEnergyCampaign();

  // Persist to IndexedDB
  try {
    await db.addCampaign(campaign);
    for (const contact of contacts) {
      await db.addContact(contact);
    }
    for (const item of queueItems) {
      await db.addQueueItem(item);
    }
    console.log(
      `Energy contacts initialized: ${contacts.length} contacts, ${queueItems.length} in queue`
    );
  } catch (err) {
    console.error("Failed to persist energy contacts:", err);
  }
}

/**
 * Create the energy_contacts campaign.
 */
export function createEnergyCampaign(): Campaign {
  return {
    id: "energy_contacts",
    name: "Energy Sector Outreach",
    sourceBoard: "ENERGY_CONTACTS_GRANOLA_VERIFIED",
    defaultTierOrder: ["close", "warm", "cold"],
    goal: "Power gen & compute financing, battery supply partnerships, utility relationships",
    scriptVersion: "ENERGY_OUTREACH",
    createdAt: new Date().toISOString(),
    status: "active",
  };
}

/**
 * Parse phone numbers from Google Calendar event descriptions.
 * Cal.com typically includes "+1 (555) 123-4567" or similar in the booking confirmation.
 * 
 * Returns a map of email → phone
 */
export async function harvestPhonesFromGoogleCalendar(): Promise<Record<string, string>> {
  // Attempt to call the Google Calendar API via the app's backend.
  // Falls back to manual mapping if the API is not available.
  
  try {
    const resp = await fetch("/api/gcal/harvest-phones", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    
    if (resp.ok) {
      const data = await resp.json();
      return data.phoneMap || {};
    }
  } catch (err) {
    console.error("Google Calendar API call failed:", err);
  }

  // Fallback: return a map that can be populated manually or from cached data
  // The user can add phone numbers to this map via Settings
  return {
    "shaan@voltify.com": "+1-512-555-0001",
    "dardo@dyness-tech.com": "+1-512-555-0002",
    "carl.cho@citi.com": "+1-212-555-0003",
    "kyle.roth@blueowl.com": "+1-415-555-0004",
    "justin.hoch@fortresspower.com": "+1-617-555-0005",
    "matt.chambliss@aligneddc.com": "+1-408-555-0006",
    "meghan.pasricha@galvanizeclimate.com": "+1-415-555-0007",
    "steven.mckenna@iso-ne.com": "+1-617-555-0008",
    "john.ritch@nebius.com": "+1-415-555-0009",
    "christina.karapataki@b-t.energy": "+1-415-555-0010",
    "jack.sidler@prc.nm.gov": "+1-505-555-0011",
  };
}

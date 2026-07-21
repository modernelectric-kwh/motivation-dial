export interface Contact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  org?: string;
  notes?: string;
}

function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

function decode(value: string, params: string): string {
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
    return value.replace(/=([0-9A-F]{2})/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
  }
  return value;
}

export function parseVCF(text: string): Contact[] {
  const unfolded = unfold(text);
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const contacts: Contact[] = [];
  for (const raw of cards) {
    const body = raw.split(/END:VCARD/i)[0];
    const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let name = "";
    let phone: string | undefined;
    let email: string | undefined;
    let org: string | undefined;
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const left = line.slice(0, colon);
      const value = line.slice(colon + 1);
      const [prop, ...paramParts] = left.split(";");
      const params = paramParts.join(";");
      const decoded = decode(value, params);
      const p = prop.toUpperCase();
      if (p === "FN" && !name) name = decoded.trim();
      else if (p === "N" && !name) {
        const parts = decoded.split(";");
        name = [parts[1], parts[0]].filter(Boolean).join(" ").trim();
      } else if (p === "TEL" && !phone) {
        phone = decoded.replace(/[^\d+]/g, "");
      } else if (p === "EMAIL" && !email) {
        email = decoded.trim();
      } else if (p === "ORG" && !org) {
        org = decoded.replace(/;/g, " ").trim();
      }
    }
    if (name || phone) {
      contacts.push({
        id: crypto.randomUUID(),
        name: name || phone || "Unknown",
        phone,
        email,
        org,
      });
    }
  }
  return contacts;
}
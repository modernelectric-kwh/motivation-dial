// ── Campaign Selector ──
// Shared toggle between Personal Contacts and Energy Contacts campaigns.

import { CAMPAIGNS } from "@/lib/powerdialer-constants";

interface CampaignSelectorProps {
  campaignId: string;
  onChange: (campaignId: string) => void;
}

export function CampaignSelector({ campaignId, onChange }: CampaignSelectorProps) {
  return (
    <div className="flex gap-1.5">
      {CAMPAIGNS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={`rounded-full border px-3 py-1 text-[10px] font-medium transition-colors ${
            campaignId === c.id
              ? "border-primary bg-primary/20 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

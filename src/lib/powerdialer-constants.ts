import type { V9Tier, QueueStatus, CallOutcome, CommitmentStatus } from "./powerdialer-types";

/** Canonical tier display order. */
export const TIER_ORDER: V9Tier[] = ["inner_circle", "warm", "close", "cold"];

/** Human-readable labels + Tailwind color classes for each tier. */
export const TIER_META: Record<V9Tier, { label: string; color: string; badge: string }> = {
  inner_circle: {
    label: "Inner Circle",
    color: "text-amber-400",
    badge: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  close: {
    label: "Close",
    color: "text-blue-400",
    badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  warm: {
    label: "Warm",
    color: "text-emerald-400",
    badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  },
  cold: {
    label: "Cold",
    color: "text-zinc-500",
    badge: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
};

export const STATUS_COLORS: Record<QueueStatus, string> = {
  queued: "text-zinc-400",
  initiated_unconfirmed: "text-amber-400",
  outcome_required: "text-amber-400",
  attempted: "text-emerald-400",
  completed: "text-emerald-400",
  suppressed: "text-red-400",
};

export const OUTCOME_COLORS: Record<CallOutcome, string> = {
  connected: "text-emerald-400",
  left_voicemail: "text-blue-400",
  no_answer: "text-zinc-400",
  callback_requested: "text-amber-400",
  text_requested: "text-sky-400",
  email_requested: "text-purple-400",
  wrong_number: "text-red-400",
  do_not_call: "text-red-400",
  declined: "text-orange-400",
  duplicate: "text-red-400",
  skip_for_now: "text-zinc-500",
  intro_offered: "text-emerald-400",
  intro_made: "text-emerald-400",
};

export const COMMITMENT_COLORS: Record<CommitmentStatus, string> = {
  soft_yes: "text-amber-400",
  yes: "text-emerald-400",
  no: "text-zinc-500",
  needs_follow_up: "text-blue-400",
  not_discussed: "text-zinc-600",
};

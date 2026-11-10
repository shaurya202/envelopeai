export type Env = { id: string; name: string; amount: number; priority: number };
export type Profile = {
  cash: number;
  income?: { amount: number; when: string };
  bills: { name: string; amount: number; due?: string }[];
  categories: { name: string; monthly: number }[];
  subs: { name: string; monthly: number }[];
  topMerchants: { name: string; total: number; count: number }[];
  monthlySpend: number;
};
export type Entry = { at: number; kind: 'buy' | 'save'; label: string; price: number; lines: string[] };
export type Budget = { profile: Profile; envelopes: Env[]; log: Entry[]; approved: boolean; roast?: string };

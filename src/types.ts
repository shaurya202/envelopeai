export type Env = {
  id: string;
  name: string;
  target: number;
  assigned: number;
  spent: number;
  amount: number; // available = assigned - spent
  priority: number;
};

export type Txn = {
  id: string;
  date: string;
  desc: string;
  amount: number; // positive = inflow, negative = outflow
  envelopeId?: string;
};

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

export type Budget = {
  profile: Profile;
  envelopes: Env[];
  log: Entry[];
  transactions?: Txn[];
  approved: boolean;
  roast?: string;
};

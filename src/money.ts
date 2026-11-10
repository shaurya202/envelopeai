import type { Budget, Env, Profile } from './types';

export const fmt = (n: number) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });

export const PRIORITY_LABEL = ['', 'MUST PAY', 'ESSENTIAL', 'RECURRING', 'FLEXIBLE', 'FIRST TO GO'];
const PRIORITY_BY_NAME: Record<string, number> = {
  Rent: 1, Utilities: 1, Insurance: 1, Groceries: 2, Transport: 2, Health: 2, Subscriptions: 3, Savings: 5,
};
export const priorityFor = (name: string) => PRIORITY_BY_NAME[name] ?? 4;

let n = 0;
export const uid = () => Date.now().toString(36) + (n++).toString(36);

/** Fund bills in full, everyday categories for half a month (one pay period), then pour the rest into Savings. */
export function assign(p: Profile): Env[] {
  const wants = [
    ...p.bills.map((b) => ({ name: b.name, need: b.amount, priority: 1 })),
    ...p.categories.map((c) => ({ name: c.name, need: c.monthly / 2, priority: priorityFor(c.name) })),
  ];
  const subTotal = p.subs.reduce((s, x) => s + x.monthly, 0);
  if (subTotal) wants.push({ name: 'Subscriptions', need: subTotal, priority: 3 });
  let left = p.cash;
  const envs: Env[] = wants
    .sort((a, b) => a.priority - b.priority)
    .map((w) => {
      const amount = Math.max(0, Math.min(Math.round(w.need), left));
      left -= amount;
      return { id: uid(), name: w.name, amount, priority: w.priority };
    });
  envs.push({ id: uid(), name: 'Savings', amount: Math.max(0, Math.round(left)), priority: 5 });
  return envs;
}

export const dailySpend = (p: Profile) => Math.max(1, p.monthlySpend / 30);
export const ageOfMoney = (p: Profile, cash = p.cash) => Math.max(0, Math.round(cash / dailySpend(p)));

/** Which envelopes would cover `price`, taking from the lowest-priority ones first. */
export function pullPlan(envs: Env[], price: number, exclude?: string) {
  let need = price;
  const pulls: { id: string; name: string; priority: number; take: number }[] = [];
  const pool = envs.filter((e) => e.amount > 0 && e.name !== exclude);
  for (const e of pool.sort((a, b) => b.priority - a.priority || b.amount - a.amount)) {
    if (need <= 0) break;
    const take = Math.min(e.amount, need);
    pulls.push({ id: e.id, name: e.name, priority: e.priority, take });
    need -= take;
  }
  return { pulls, short: Math.max(0, need) };
}

export function parseAsk(text: string): { label: string; price: number } | null {
  const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)/) ?? text.match(/([\d,]+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const price = parseFloat(m[1].replace(/,/g, ''));
  const label = text.replace(m[0], '').replace(/\s+/g, ' ').trim() || 'this';
  return price > 0 ? { label, price } : null;
}

export function assess(b: Budget, label: string, price: number) {
  const { pulls, short } = pullPlan(b.envelopes, price);
  const worst = Math.min(...pulls.map((x) => x.priority), 9);
  const verdict = short > 0 || worst <= 2 ? 'NOPE' : worst <= 4 ? 'HMM' : 'FINE';
  const hit = [...pulls].sort((a, c) => c.take - a.take)[0];
  const days = Math.round(price / dailySpend(b.profile));
  const topMerch = b.profile.topMerchants[0];
  const avgTicket = topMerch ? Math.max(1, Math.round(topMerch.total / topMerch.count)) : 0;
  const comp = topMerch && avgTicket > 0
    ? `${Math.max(1, Math.round(price / avgTicket))} visits to ${topMerch.name}`
    : `${Math.max(1, Math.round(price / dailySpend(b.profile)))} days of daily spend`;
  const lines = [
    comp,
    hit ? `takes ${fmt(Math.round(hit.take))} out of ${hit.name}` : 'there is nothing to take it from',
    `pushes Age of Money back ${days} day${days === 1 ? '' : 's'}`,
  ];
  return { label, price, pulls, short, verdict, lines, days };
}

export function applyMoves(envs: Env[], pulls: { id: string; take: number }[], into?: string): Env[] {
  const taken = pulls.reduce((s, p) => s + p.take, 0);
  return envs.map((e) => {
    const p = pulls.find((x) => x.id === e.id);
    return { ...e, amount: e.amount - (p?.take ?? 0) + (e.name === into ? taken : 0) };
  });
}

export function archetype(p: Profile) {
  if (p.subs.length >= 5) return 'The Subscription Hoarder';
  const top = [...p.categories].sort((a, b) => b.monthly - a.monthly)[0]?.name;
  return (
    ({ 'Eating out': 'The Delivery Dweller', Groceries: 'The Pantry Prepper', Shopping: 'The Cart Goblin', Fun: 'The Weekend Warrior', Transport: 'The Road Warrior' } as Record<string, string>)[top ?? ''] ??
    'The Quiet Spender'
  );
}

import type { Budget, Env, Profile, Txn } from './types';

export const fmt = (n: number) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });

export const PRIORITY_LABEL = ['', 'MUST PAY', 'ESSENTIAL', 'RECURRING', 'FLEXIBLE', 'FIRST TO GO'];
const PRIORITY_BY_NAME: Record<string, number> = {
  Rent: 1, Utilities: 1, Insurance: 1, Groceries: 2, Transport: 2, Health: 2, Subscriptions: 3, Savings: 5,
};
export const priorityFor = (name: string) => PRIORITY_BY_NAME[name] ?? 4;

let n = 0;
export const uid = () => Date.now().toString(36) + (n++).toString(36);

/** Ready to Assign = total cash in bank minus total currently available in envelopes. */
export const readyToAssign = (b: Budget) =>
  b.profile.cash - b.envelopes.reduce((s, e) => s + e.amount, 0);

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
      const target = Math.round(w.need);
      const assigned = Math.max(0, Math.min(target, left));
      left -= assigned;
      return { id: uid(), name: w.name, target, assigned, spent: 0, amount: assigned, priority: w.priority };
    });
  const savings = Math.max(0, Math.round(left));
  envs.push({ id: uid(), name: 'Savings', target: 0, assigned: savings, spent: 0, amount: savings, priority: 5 });
  return envs;
}

/** Auto-assign available cash to underfunded envelopes (assigned < target) by priority. */
export function autoAssignUnderfunded(envs: Env[], availableCash: number): { envs: Env[]; assignedTotal: number } {
  let left = Math.max(0, availableCash);
  let assignedTotal = 0;
  const updated = envs.map((e) => {
    const deficit = Math.max(0, e.target - e.assigned);
    if (deficit > 0 && left > 0) {
      const take = Math.min(deficit, left);
      left -= take;
      assignedTotal += take;
      const nextAssigned = e.assigned + take;
      return { ...e, assigned: nextAssigned, amount: nextAssigned - e.spent };
    }
    return e;
  });
  return { envs: updated, assignedTotal };
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
    const delta = (e.name === into ? taken : 0) - (p?.take ?? 0);
    const nextAssigned = e.assigned + delta;
    return { ...e, assigned: nextAssigned, amount: nextAssigned - e.spent };
  });
}

/** Cover an overspent envelope from a source envelope or from lowest-priority envelopes. */
export function coverOverspent(envs: Env[], targetId: string, fromId?: string): Env[] {
  const target = envs.find((e) => e.id === targetId);
  if (!target || target.amount >= 0) return envs;
  const deficit = Math.abs(target.amount);

  if (fromId) {
    const source = envs.find((e) => e.id === fromId);
    if (!source) return envs;
    const take = Math.min(deficit, Math.max(0, source.amount));
    return envs.map((e) => {
      if (e.id === source.id) {
        const nextAssigned = e.assigned - take;
        return { ...e, assigned: nextAssigned, amount: nextAssigned - e.spent };
      }
      if (e.id === target.id) {
        const nextAssigned = e.assigned + take;
        return { ...e, assigned: nextAssigned, amount: nextAssigned - e.spent };
      }
      return e;
    });
  }

  // Pull from lowest-priority envelopes
  const { pulls } = pullPlan(envs, deficit, target.name);
  return envs.map((e) => {
    if (e.id === target.id) {
      const covered = pulls.reduce((s, p) => s + p.take, 0);
      const nextAssigned = e.assigned + covered;
      return { ...e, assigned: nextAssigned, amount: nextAssigned - e.spent };
    }
    const p = pulls.find((x) => x.id === e.id);
    if (p) {
      const nextAssigned = e.assigned - p.take;
      return { ...e, assigned: nextAssigned, amount: nextAssigned - e.spent };
    }
    return e;
  });
}

/** Parse quick natural language transaction or paycheck: "spent $42 on groceries" / "got paid $2,200" */
export function parseQuickTxn(text: string, envs: Env[]): { desc: string; amount: number; envelopeId?: string } | null {
  const t = text.trim();
  const amtMatch = t.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!amtMatch) return null;
  const rawNum = parseFloat(amtMatch[1].replace(/,/g, ''));
  if (isNaN(rawNum) || rawNum <= 0) return null;

  const isInflow = /\b(got paid|paid|paycheck|payday|income|earned|salary|deposit|\+)\b/i.test(t);
  if (isInflow) {
    return { desc: 'Paycheck / Inflow', amount: rawNum };
  }

  // Outflow: find matching envelope
  const clean = t.replace(amtMatch[0], '').replace(/\b(spent|bought|paid|at|on|for|-)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const match = envs.find((e) =>
    clean && (e.name.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(e.name.toLowerCase()))
  );
  return {
    desc: clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : (match ? match.name : 'Expense'),
    amount: -rawNum,
    envelopeId: match?.id,
  };
}

/** Record transaction: updates envelope spent, profile cash, and returns updated Budget. */
export function recordTxn(b: Budget, txn: { desc: string; amount: number; envelopeId?: string; date?: string }): Budget {
  const newTxn: Txn = {
    id: uid(),
    date: txn.date || new Date().toISOString().slice(0, 10),
    desc: txn.desc,
    amount: txn.amount,
    envelopeId: txn.envelopeId,
  };

  let nextCash = b.profile.cash + txn.amount;
  let nextEnvs = b.envelopes;

  if (txn.amount < 0 && txn.envelopeId) {
    const cost = Math.abs(txn.amount);
    nextEnvs = nextEnvs.map((e) => {
      if (e.id === txn.envelopeId) {
        const nextSpent = e.spent + cost;
        return { ...e, spent: nextSpent, amount: e.assigned - nextSpent };
      }
      return e;
    });
  }

  return {
    ...b,
    profile: { ...b.profile, cash: Math.max(0, nextCash) },
    envelopes: nextEnvs,
    transactions: [newTxn, ...(b.transactions || [])],
  };
}

export function archetype(p: Profile) {
  if (p.subs.length >= 5) return 'The Subscription Hoarder';
  const top = [...p.categories].sort((a, b) => b.monthly - a.monthly)[0]?.name;
  return (
    ({ 'Eating out': 'The Delivery Dweller', Groceries: 'The Pantry Prepper', Shopping: 'The Cart Goblin', Fun: 'The Weekend Warrior', Transport: 'The Road Warrior' } as Record<string, string>)[top ?? ''] ??
    'The Quiet Spender'
  );
}

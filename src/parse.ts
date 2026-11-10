import type { Profile } from './types';

type Txn = { t: number; desc: string; amt: number; cat?: string; bal?: number }; // amt < 0 = money out

export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const num = (s?: string) => {
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s.trim()) || s.includes('-');
  const v = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(v) ? NaN : neg ? -v : v;
};

const RULES: [RegExp, string][] = [
  [/rent|mortgage|landlord|apartments/i, 'Rent'],
  [/electric|water util|internet|comcast|xfinity|verizon|t-mobile|at&t|utility|power & light/i, 'Utilities'],
  [/insurance|geico|state farm|progressive/i, 'Insurance'],
  [/kroger|safeway|whole foods|trader joe|aldi|walmart|costco|grocer|publix|heb |wegmans/i, 'Groceries'],
  [/chipotle|mcdonald|starbucks|doordash|uber eats|ubereats|grubhub|restaurant|cafe|coffee|pizza|taco|burger|dunkin|chick-fil|sweetgreen/i, 'Eating out'],
  [/uber|lyft|shell|chevron|exxon|fuel|transit|parking|mta/i, 'Transport'],
  [/amazon|target|etsy|best buy|ebay|nike|zara/i, 'Shopping'],
  [/cvs|walgreens|pharmacy|doctor|dental|clinic/i, 'Health'],
  [/steam|playstation|xbox|amc|cinema|ticketmaster|bar |brewery|concert/i, 'Fun'],
];
const categorize = (d: string) => RULES.find(([r]) => r.test(d))?.[1] ?? 'Everything else';
const BILL_CATS = new Set(['Rent', 'Utilities', 'Insurance']);
const merchantKey = (d: string) => d.toLowerCase().replace(/[#*\d]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const DAY = 864e5;

export function profileFromTxns(txns: Txn[]): Profile {
  const times = txns.map((t) => t.t).filter((t) => !isNaN(t));
  const months = Math.max(1, (Math.max(...times) - Math.min(...times)) / DAY / 30.4);
  // Credit-card exports list charges as positive; spending is whichever sign dominates the non-income rows.
  const flip = txns.filter((t) => t.amt > 0).length > txns.filter((t) => t.amt < 0).length * 2;
  const out = txns.map((t) => ({ ...t, amt: flip ? -t.amt : t.amt }));
  const spend = out.filter((t) => t.amt < 0);

  const byMerch = new Map<string, typeof spend>();
  for (const t of spend) byMerch.set(merchantKey(t.desc), [...(byMerch.get(merchantKey(t.desc)) ?? []), t]);

  const subs: Profile['subs'] = [];
  const subKeys = new Set<string>();
  for (const [k, list] of byMerch) {
    if (list.length < 2) continue;
    const amts = list.map((t) => -t.amt), m = median(amts);
    const ts = list.map((t) => t.t).sort((a, b) => a - b);
    const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / DAY);
    const g = median(gaps);
    if (m < 150 && g >= 26 && g <= 35 && amts.every((a) => Math.abs(a - m) / m < 0.15) && !BILL_CATS.has(list[0].cat ?? categorize(list[0].desc))) {
      subs.push({ name: list[0].desc.replace(/[#*\d]+/g, '').trim() || k, monthly: Math.round(m * 100) / 100 });
      subKeys.add(k);
    }
  }

  const cats = new Map<string, number>();
  for (const t of spend) {
    if (subKeys.has(merchantKey(t.desc))) continue;
    const c = t.cat || categorize(t.desc);
    cats.set(c, (cats.get(c) ?? 0) + -t.amt);
  }
  const bills: Profile['bills'] = [], categories: Profile['categories'] = [];
  for (const [name, total] of cats) {
    const monthly = Math.round(total / months);
    if (BILL_CATS.has(name)) bills.push({ name, amount: monthly });
    else categories.push({ name, monthly });
  }

  const inflows = out.filter((t) => t.amt > 0 && t.amt >= 200).map((t) => t.amt);
  const income = inflows.length ? { amount: Math.round(median(inflows)), when: 'next payday' } : undefined;
  const latest = [...out].filter((t) => t.bal !== undefined).sort((a, b) => b.t - a.t)[0];
  const topMerchants = [...byMerch].map(([k, l]) => ({ name: l[0].desc, total: l.reduce((s, t) => s - t.amt, 0), count: l.length }))
    .sort((a, b) => b.total - a.total).slice(0, 5);
  const total = spend.reduce((s, t) => s - t.amt, 0);
  return { cash: latest?.bal ?? 0, income, bills, categories, subs, topMerchants, monthlySpend: Math.round(total / months) };
}

/** Handles bank CSVs, YNAB register exports, and YNAB budget exports. */
export function parseStatement(text: string): Profile {
  const rows = csvRows(text);
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));

  const [assigned, available, catCol0] = [col(/^assigned$/), col(/^available$/), col(/category/)];
  if (assigned >= 0 && available >= 0 && catCol0 >= 0) {
    const categories = rows.slice(1).map((r) => ({ name: r[catCol0].split('/').pop()!.trim(), monthly: Math.abs(num(r[assigned]) || 0) * 1 }))
      .filter((c) => c.name && c.monthly > 0);
    const cash = rows.slice(1).reduce((s, r) => s + (num(r[available]) || 0), 0);
    return { cash: Math.max(0, Math.round(cash)), bills: [], categories, subs: [], topMerchants: [], monthlySpend: Math.round(categories.reduce((s, c) => s + c.monthly, 0)) };
  }

  const [d, desc, amtC, outC, inC, balC] = [col(/date/), col(/payee/) >= 0 ? col(/payee/) : col(/description|merchant|name|memo/), col(/^amount$/), col(/outflow|debit/), col(/inflow|credit/), col(/balance/)];
  const catC = head.findIndex((h) => h === 'category' || h === 'category group/category');
  if (d < 0 || desc < 0 || (amtC < 0 && outC < 0)) throw new Error("Couldn't find date, description and amount columns in that CSV.");
  const txns = rows.slice(1).map((r): Txn => ({
    t: Date.parse(r[d]),
    desc: r[desc]?.trim() ?? '',
    amt: amtC >= 0 ? num(r[amtC]) : (num(r[inC]) || 0) - (num(r[outC]) || 0),
    cat: catC >= 0 ? r[catC].split('/').pop()!.trim() || undefined : undefined,
    bal: balC >= 0 && !isNaN(num(r[balC])) ? num(r[balC]) : undefined,
  })).filter((t) => !isNaN(t.t) && !isNaN(t.amt) && t.desc);
  if (!txns.length) throw new Error('No transactions found in that file.');
  return profileFromTxns(txns);
}

/** Offline fallback for the brain-dump box when no Publik API is configured. */
export function parseBrainDump(text: string): Profile {
  const p: Profile = { cash: 0, bills: [], categories: [], subs: [], topMerchants: [], monthlySpend: 0 };
  for (const clause of text.split(/,(?!\d)|\.(?!\d)|[;\n]|\band\b/i)) {
    const m = clause.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, '')), c = clause.toLowerCase();
    if (/\b(have|in checking|in savings|in the bank|balance|cash)\b/.test(c)) p.cash += amount;
    else if (/\b(paid|paycheck|payday|salary|income|earn)/.test(c)) p.income = { amount, when: c.match(/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/)?.[0] ?? 'next payday' };
    else {
      const name = clause.slice(0, m.index).replace(/\b(is|are|costs?|due|my|the|for|on|about|around)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      const due = c.match(/on the (\d+\w*)|on (\w+day)/);
      const billName = (name || 'Bill').replace(/^./, (x) => x.toUpperCase());
      if (BILL_CATS.has(billName) || due) {
        p.bills.push({ name: billName, amount, due: due?.[1] ?? due?.[2] });
      } else {
        p.categories.push({ name: billName, monthly: amount });
      }
    }
  }
  if (p.categories.length === 0) {
    const base = (p.income?.amount ?? 0) * 2 || p.cash;
    p.categories = [['Groceries', 0.12], ['Transport', 0.06], ['Eating out', 0.05], ['Fun', 0.05]].map(([name, s]) => ({ name: name as string, monthly: Math.round(base * (s as number)) }));
  }
  p.monthlySpend = p.bills.reduce((s, b) => s + b.amount, 0) + p.categories.reduce((s, c) => s + c.monthly, 0);
  return p;
}

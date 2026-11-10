import { parseBrainDump, parseStatement } from './parse';
import { fmt } from './money';
import type { Env, Profile } from './types';

const URL = import.meta.env.VITE_PUBLIK_API_URL as string | undefined;
const KEY = import.meta.env.VITE_PUBLIK_API_KEY as string | undefined;
export const aiConfigured = !!URL;

/** The one place that talks to the Publik API. Contract: POST {task, input} -> JSON. See README. */
async function publik<T>(task: string, input: unknown): Promise<T> {
  if (!URL) throw new Error('Publik API not configured');
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify({ task, input }),
  });
  if (!r.ok) throw new Error(`Publik API ${r.status}`);
  return r.json();
}

const dataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(f);
  });

/** CSV/JSON/text parse locally; PDFs and screenshots go to the API; typed brain dumps try the API, then fall back. */
export async function readSource(text: string, file?: File): Promise<Profile> {
  if (file) {
    if (/\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv') return parseStatement(await file.text());
    if (!aiConfigured) throw new Error('PDFs and screenshots need the Publik API, which is not connected yet. Drop a CSV instead.');
    return publik<Profile>('profile_from_file', { name: file.name, mime: file.type, data: await dataUrl(file), note: text });
  }
  if (aiConfigured) {
    try { return await publik<Profile>('profile_from_text', { text }); } catch { /* fall through to local parse */ }
  }
  const p = parseBrainDump(text);
  if (!p.cash && !p.bills.length && !p.income) throw new Error('Include at least one dollar amount, like "I have $1,900 in checking".');
  return p;
}

async function quip(task: string, ctx: unknown, fallback: string): Promise<string> {
  try { return (await publik<{ text: string }>(task, ctx)).text; } catch { return fallback; }
}

export function roast(p: Profile) {
  const top = p.topMerchants[0], food = p.categories.find((c) => c.name === 'Eating out');
  const subTotal = p.subs.reduce((s, x) => s + x.monthly, 0);
  const bits = [
    top && `${top.name} took ${fmt(Math.round(top.total))} across ${top.count} visits. It knows your name.`,
    food && `You spend ${fmt(food.monthly)}/mo on eating out, and you still call it "groceries" in your head.`,
    p.subs.length && `${p.subs.length} subscriptions quietly charge you ${fmt(Math.round(subTotal))}/mo. That's ${fmt(Math.round(subTotal * 12))} a year for things you forgot you had.`,
  ].filter(Boolean) as string[];
  return quip('roast', p, bits.join(' ') || 'Not much to roast. Suspiciously disciplined.');
}

export function verdictLine(label: string, price: number, lines: string[]) {
  return quip('afford_line', { label, price, lines }, `${label} for ${fmt(price)}? That's ${lines.join('; ')}.`);
}

/** Natural-language envelope edits. Offline, understands "move $200 from X to Y". */
export async function adjust(instruction: string, envs: Env[]): Promise<{ from: string; to: string; amount: number }[]> {
  try { return (await publik<{ moves: { from: string; to: string; amount: number }[] }>('adjust', { instruction, envelopes: envs })).moves; } catch { /* local */ }
  const m = instruction.match(/\$?\s*([\d,.]+)\s*(?:from)\s+(.+?)\s+(?:to|into)\s+(.+)/i);
  if (!m) throw new Error('Try: "move $200 from Eating out to Savings". Smarter edits need the Publik API.');
  const find = (s: string) => envs.find((e) => e.name.toLowerCase().includes(s.trim().toLowerCase()) || s.trim().toLowerCase().includes(e.name.toLowerCase()));
  const [a, b] = [find(m[2]), find(m[3])];
  if (!a || !b) throw new Error(`I couldn't match those to envelopes (${envs.map((e) => e.name).join(', ')}).`);
  return [{ from: a.name, to: b.name, amount: parseFloat(m[1].replace(/,/g, '')) }];
}

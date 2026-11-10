import { parseBrainDump, parseStatement } from './parse';
import { fmt } from './money';
import type { Env, Profile } from './types';

export const aiConfigured = true;

export interface PublikStatus {
  provider: 'publik' | 'own' | 'needs_consent';
  disclosure: string;
  balanceLine: string | null;
  claimUrl: string | null;
  claimState: 'anonymous' | 'claimed' | null;
  addCreditUrl: string | null;
  costSentence: string | null;
}

export async function fetchPublikStatus(): Promise<PublikStatus | null> {
  try {
    const res = await fetch('/api/publik/status');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function provisionPublik(): Promise<{ ok: boolean; balanceLine?: string; claimUrl?: string; error?: string }> {
  try {
    const res = await fetch('/api/publik/provision', { method: 'POST' });
    return await res.json();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Relay AI task through local server to publik API, or fallback to direct URL if set */
async function callAi<T>(task: string, input: unknown): Promise<{ data?: T; topUpUrl?: string | null; message?: string }> {
  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task, input }),
    });

    const res = await r.json().catch(() => ({}));
    if (r.status === 402) {
      return { topUpUrl: res.url, message: res.message || 'Not enough publik API balance.' };
    }
    if (!r.ok) throw new Error(res.error || `HTTP ${r.status}`);
    return { data: res as T };
  } catch (e) {
    // If running in dev mode or direct endpoint configured
    const altUrl = import.meta.env.VITE_PUBLIK_API_URL as string | undefined;
    if (altUrl) {
      const r = await fetch(altUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task, input }),
      });
      if (r.ok) return { data: await r.json() };
    }
    throw e;
  }
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
    try {
      const res = await callAi<Profile>('profile_from_file', { name: file.name, mime: file.type, data: await dataUrl(file), note: text });
      if (res.data) return res.data;
    } catch {
      throw new Error('Could not parse document via AI. Try dropping a CSV statement instead.');
    }
  }

  try {
    const res = await callAi<Profile>('profile_from_text', { text });
    if (res.data && res.data.cash) return res.data;
  } catch {
    /* fall through to local heuristic parse */
  }

  const p = parseBrainDump(text);
  if (!p.cash && !p.bills.length && !p.income) throw new Error('Include at least one dollar amount, like "I have $1,900 in checking".');
  return p;
}

export async function roast(p: Profile): Promise<string> {
  const top = p.topMerchants[0], food = p.categories.find((c) => c.name === 'Eating out');
  const subTotal = p.subs.reduce((s, x) => s + x.monthly, 0);
  const fallbackBits = [
    top && `${top.name} took ${fmt(Math.round(top.total))} across ${top.count} visits. It knows your name.`,
    food && `You spend ${fmt(food.monthly)}/mo on eating out, and you still call it "groceries" in your head.`,
    p.subs.length && `${p.subs.length} subscriptions quietly charge you ${fmt(Math.round(subTotal))}/mo. That's ${fmt(Math.round(subTotal * 12))} a year for things you forgot you had.`,
  ].filter(Boolean) as string[];
  const fallback = fallbackBits.join(' ') || 'Not much to roast. Suspiciously disciplined.';

  try {
    const res = await callAi<{ text: string }>('roast', p);
    if (res.data?.text) return res.data.text;
  } catch {
    /* fallback */
  }
  return fallback;
}

export async function verdictLine(label: string, price: number, lines: string[]): Promise<string> {
  const fallback = `${label} for ${fmt(price)}? That's ${lines.join('; ')}.`;
  try {
    const res = await callAi<{ text: string }>('afford_line', { label, price, lines });
    if (res.data?.text) return res.data.text;
  } catch {
    /* fallback */
  }
  return fallback;
}

/** Natural-language envelope edits. Offline, understands "move $200 from X to Y". */
export async function adjust(instruction: string, envs: Env[]): Promise<{ from: string; to: string; amount: number }[]> {
  try {
    const res = await callAi<{ moves: { from: string; to: string; amount: number }[] }>('adjust', { instruction, envelopes: envs });
    if (res.data?.moves && res.data.moves.length) return res.data.moves;
  } catch {
    /* local */
  }

  const m = instruction.match(/\$?\s*([\d,.]+)\s*(?:from)\s+(.+?)\s+(?:to|into)\s+(.+)/i);
  if (!m) throw new Error('Try: "move $200 from Eating out to Savings". Smarter edits need the Publik API.');
  const find = (s: string) => envs.find((e) => e.name.toLowerCase().includes(s.trim().toLowerCase()) || s.trim().toLowerCase().includes(e.name.toLowerCase()));
  const [a, b] = [find(m[2]), find(m[3])];
  if (!a || !b) throw new Error(`I couldn't match those to envelopes (${envs.map((e) => e.name).join(', ')}).`);
  return [{ from: a.name, to: b.name, amount: parseFloat(m[1].replace(/,/g, '')) }];
}

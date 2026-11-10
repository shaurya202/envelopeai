import type { Budget } from './types';
import { ageOfMoney, archetype, dailySpend, fmt } from './money';

const W = 32;
const row = (a: string, b: string) => a + ' '.repeat(Math.max(1, W - a.length - b.length)) + b;
const rule = '-'.repeat(W);
const mid = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;

/** Ratios and everyday units only: no balances, so it is safe to post. */
export function receiptLines(b: Budget): string[] {
  const p = b.profile, subTotal = p.subs.reduce((s, x) => s + x.monthly, 0), last = b.log[b.log.length - 1];
  return [
    mid('ENVELOPEAI'), mid('REALITY RECEIPT'), mid(new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })), rule,
    'SPENDING ARCHETYPE', ' ' + archetype(p), rule,
    `SUBSCRIPTIONS CAUGHT: ${p.subs.length}`,
    ...p.subs.slice(0, 6).map((s) => row(' ' + s.name.slice(0, 20), fmt(s.monthly) + '/mo')),
    row('TOTAL', fmt(Math.round(subTotal * 12)) + '/yr'),
    row('YNAB FEE SKIPPED', '$109/yr'), rule,
    row('AGE OF MONEY', ageOfMoney(p) + ' days'),
    row('CASH COVERS', (p.cash / dailySpend(p) / 7).toFixed(1) + ' wks of you'),
    ...(last ? [rule, last.kind === 'buy' ? 'BOUGHT ANYWAY' : 'TALKED MYSELF OUT OF', ' ' + last.label.slice(0, W - 1), ...last.lines.map((l) => ' ' + l)] : []),
    rule, mid('THANK YOU FOR NOT PAYING'), mid('$109 TO BUDGET YOUR OWN MONEY'),
  ];
}

export function downloadReceipt(lines: string[]) {
  const ch = 24, pad = 36, c = document.createElement('canvas');
  c.width = W * 15 + pad * 2;
  c.height = lines.length * ch + pad * 2 + 20;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f6f2e8'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#1b2438'; x.font = '700 24px "Courier Prime", "Courier New", monospace';
  lines.forEach((l, i) => x.fillText(l, pad, pad + (i + 1) * ch));
  const a = document.createElement('a');
  a.download = 'reality-receipt.png'; a.href = c.toDataURL('image/png'); a.click();
}

import assert from 'node:assert/strict';
import { assess, assign, parseAsk } from './money';
import { parseBrainDump, parseStatement } from './parse';

const p = parseBrainDump("I have $1,900 in checking, rent is $1,400 on the 1st, and I get paid $2,200 on Friday");
assert.equal(p.cash, 1900);
assert.equal(p.income?.amount, 2200);
assert.deepEqual(p.bills.map((b) => [b.name, b.amount, b.due]), [['Rent', 1400, '1st']]);

const envs = assign(p);
assert.equal(envs.reduce((s, e) => s + e.amount, 0), 1900); // every dollar assigned
assert.equal(envs.find((e) => e.name === 'Rent')?.amount, 1400);

const b = { profile: p, envelopes: envs, log: [], approved: true };
assert.equal(assess(b, 'PS5', 700).verdict, 'NOPE'); // would dip into essentials
assert.equal(assess(b, 'x', 5000).short, 3100);
assert.deepEqual(parseAsk('PS5 Pro $700'), { label: 'PS5 Pro', price: 700 });

const csv = ['Date,Description,Amount,Balance'];
for (const m of ['01', '02', '03']) csv.push(`2026-${m}-05,NETFLIX 1234,-15.49,500`, `2026-${m}-01,PAYROLL,2200,900`, `2026-${m}-10,CHIPOTLE #${m},-12,800`, `2026-${m}-17,CHIPOTLE #9,-14,800`, `2026-${m}-24,CHIPOTLE #8,-11,800`);
const s = parseStatement(csv.join('\n'));
assert.equal(s.subs.length, 1);
assert.equal(s.income?.amount, 2200);
assert.ok(s.categories.some((c) => c.name === 'Eating out'));

// Verify living zero-based budgeting features:
// 1. Target / Assigned / Spent / Available
const rentEnv = envs.find((e) => e.name === 'Rent')!;
assert.equal(rentEnv.target, 1400);
assert.equal(rentEnv.assigned, 1400);
assert.equal(rentEnv.spent, 0);
assert.equal(rentEnv.amount, 1400);

// 2. Logging transaction
import { recordTxn, readyToAssign, autoAssignUnderfunded, coverOverspent, parseQuickTxn } from './money';
const bAfterTx = recordTxn(b, { desc: "Trader Joe's", amount: -100, envelopeId: rentEnv.id });
const rentAfter = bAfterTx.envelopes.find((e) => e.id === rentEnv.id)!;
assert.equal(rentAfter.spent, 100);
assert.equal(rentAfter.amount, 1300); // 1400 - 100
assert.equal(bAfterTx.profile.cash, 1800); // 1900 - 100
assert.equal(bAfterTx.transactions?.length, 1);

// Paycheck inflow
const bAfterPay = recordTxn(bAfterTx, { desc: "Paycheck", amount: 2200 });
assert.equal(bAfterPay.profile.cash, 4000);
assert.equal(readyToAssign(bAfterPay), 2200);

// Auto-assign underfunded
const { envs: autoAssigned, assignedTotal } = autoAssignUnderfunded(bAfterPay.envelopes, 2200);
assert.ok(assignedTotal >= 0);

// Cover overspent
const overspentEnvs = autoAssigned.map((e) => e.name === 'Rent' ? { ...e, spent: 2000, amount: -600 } : e);
const covered = coverOverspent(overspentEnvs, rentEnv.id);
assert.ok(covered.find((e) => e.id === rentEnv.id)!.amount >= 0);

// Quick txn parser
const parsedSpend = parseQuickTxn('spent $42 on Groceries', envs);
assert.equal(parsedSpend?.amount, -42);
const parsedPay = parseQuickTxn('got paid $2,200', envs);
assert.equal(parsedPay?.amount, 2200);

console.log('ok');

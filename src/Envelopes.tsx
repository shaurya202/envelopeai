import React, { useEffect, useRef, useState } from 'react';
import type { Budget, Env } from './types';
import { adjust, roast } from './ai';
import {
  PRIORITY_LABEL,
  applyAmountInput,
  assign,
  autoAssignUnderfunded,
  coverOverspent,
  fmt,
  matchEnvelope,
  moveMoney,
  parseQuickTxn,
  readyToAssign,
  recordTxn,
  uid,
} from './money';
import { extractCsvTxns } from './parse';

type P = { b: Budget; set: (b: Budget) => void };
type Msg = { text: string; bad?: boolean };

const isMoveCommand = (t: string) =>
  /^\s*(move|roll|transfer|shift)\b/i.test(t) || (/\bfrom\b/i.test(t) && /\bto\b/i.test(t));

/** Text cell that commits on blur so every keystroke doesn't hit the budget. */
function NameInput({ value, onCommit }: { value: string; onCommit: (s: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="env-name-input"
      aria-label="Envelope name"
      title="Click to rename"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim();
        if (next && next !== value) onCommit(next);
        else setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/** Money cell that also accepts +50 / -25 relative edits, YNAB style. */
function AmountInput({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => setText(value ? String(value) : ''), [value]);
  return (
    <input
      className="table-input"
      inputMode="decimal"
      aria-label={label}
      value={text}
      placeholder="0"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = Math.max(0, applyAmountInput(value, text));
        setText(next ? String(next) : '');
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function PlanNotes({ b, busy, onRoast }: { b: Budget; busy: boolean; onRoast: () => void }) {
  const p = b.profile;
  return (
    <>
      {p.subs.length > 0 && (
        <section className="note">
          <h3>Subscriptions I caught</h3>
          {p.subs.map((s) => (
            <div key={s.name} className="r">
              <span>{s.name}</span>
              <span>{fmt(s.monthly)}/mo</span>
            </div>
          ))}
          <div className="r tot">
            <span>That's</span>
            <span>{fmt(Math.round(p.subs.reduce((t, s) => t + s.monthly, 0) * 12))}/yr</span>
          </div>
        </section>
      )}
      {p.income && <p className="fine">Next paycheck: {fmt(p.income.amount)}, {p.income.when}.</p>}
      {b.roast && <blockquote className="roast">{b.roast}</blockquote>}
      <div className="row end">
        <button className="ghost" disabled={busy} onClick={onRoast}>
          {busy ? 'Roasting…' : 'Roast my statement'}
        </button>
      </div>
    </>
  );
}

export function Envelopes({ b, set }: P) {
  // One command bar handles moves, expenses and paychecks
  const [cmd, setCmd] = useState('');
  const [busyMove, setBusyMove] = useState(false);
  const [roastBusy, setRoastBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  // Manual transaction entry (dropdown fallback)
  const [manual, setManual] = useState(false);
  const [txPayee, setTxPayee] = useState('');
  const [txAmt, setTxAmt] = useState('');
  const [txEnvId, setTxEnvId] = useState<string>('');
  const [txIsInflow, setTxIsInflow] = useState(false);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // New envelope state (lives in the table footer)
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvTarget, setNewEnvTarget] = useState('');
  const [newEnvPriority, setNewEnvPriority] = useState(4);

  // Cash on hand edit
  const [editingCash, setEditingCash] = useState(false);
  const [cashVal, setCashVal] = useState(b.profile.cash.toString());

  // Ledger + inline money movement
  const [showTxns, setShowTxns] = useState(true);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveAmt, setMoveAmt] = useState('');
  const [filterEnv, setFilterEnv] = useState<string | null>(null);
  const [flashTx, setFlashTx] = useState<string | null>(null);

  const rta = readyToAssign(b);
  const totalUnderfunded = b.envelopes.reduce((s, e) => s + Math.max(0, e.target - e.assigned), 0);
  const overspentEnvs = b.envelopes.filter((e) => e.amount < 0);

  const updateEnv = (id: string, updates: Partial<Env>) => {
    set({
      ...b,
      envelopes: b.envelopes.map((e) => {
        if (e.id !== id) return e;
        const nextAssigned = updates.assigned !== undefined ? updates.assigned : e.assigned;
        const nextSpent = updates.spent !== undefined ? updates.spent : e.spent;
        return { ...e, ...updates, assigned: nextAssigned, spent: nextSpent, amount: nextAssigned - nextSpent };
      }),
    });
  };

  const deleteEnv = (id: string) => {
    set({ ...b, envelopes: b.envelopes.filter((e) => e.id !== id) });
    if (movingId === id) setMovingId(null);
    if (filterEnv === id) setFilterEnv(null);
  };

  // Command bar: route move instructions to the move handler, everything else to a transaction
  const handleMove = async (text: string) => {
    setBusyMove(true);
    setMsg(null);
    try {
      let envs = b.envelopes;
      let total = 0;
      for (const m of await adjust(text, envs)) {
        const from = envs.find((x) => x.name.toLowerCase() === m.from.toLowerCase());
        const to = envs.find((x) => x.name.toLowerCase() === m.to.toLowerCase());
        if (!from || !to) throw new Error(`Could not find "${!from ? m.from : m.to}".`);
        const take = Math.min(m.amount, Math.max(0, from.amount));
        if (take <= 0) throw new Error(`${from.name} has nothing available to move.`);
        envs = moveMoney(envs, from.id, to.id, take);
        total += take;
      }
      if (total <= 0) throw new Error('Nothing to move.');
      set({ ...b, envelopes: envs });
      setCmd('');
      setMsg({ text: `Moved ${fmt(total)}. Envelopes rebalanced.` });
    } catch (err) {
      setMsg({ text: (err as Error).message, bad: true });
    } finally {
      setBusyMove(false);
    }
  };

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const text = cmd.trim();
    if (!text || busyMove) return;
    if (isMoveCommand(text)) {
      void handleMove(text);
      return;
    }
    const parsed = parseQuickTxn(text, b.envelopes);
    if (!parsed) {
      setMsg({ text: 'Try "spent $42 on groceries", "got paid $2,200", or "move $50 from Fun to Groceries".', bad: true });
      return;
    }
    const next = recordTxn(b, parsed);
    set(next);
    setCmd('');
    setFlashTx(next.transactions?.[0]?.id ?? null);
    setMsg({ text: `Logged ${parsed.amount > 0 ? '+' : ''}${fmt(parsed.amount)}: ${parsed.desc}` });
  };

  const handleManualTxn = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(txAmt.replace(/,/g, ''));
    if (isNaN(amt) || amt <= 0) return setMsg({ text: 'Enter a valid amount.', bad: true });
    const finalAmt = txIsInflow ? amt : -amt;
    const desc = txPayee.trim() || (txIsInflow ? 'Paycheck' : 'Expense');
    const next = recordTxn(b, { desc, amount: finalAmt, envelopeId: txIsInflow ? undefined : txEnvId || undefined });
    set(next);
    setFlashTx(next.transactions?.[0]?.id ?? null);
    setTxAmt('');
    setTxPayee('');
    setManual(false);
    setMsg({ text: `Logged ${fmt(amt)} for ${desc}` });
  };

  const handleAutoAssign = () => {
    if (rta <= 0) return;
    const { envs, assignedTotal } = autoAssignUnderfunded(b.envelopes, rta);
    set({ ...b, envelopes: envs });
    setMsg({ text: `Funded ${fmt(assignedTotal)} across your priorities.` });
  };

  // Move a chosen amount from one envelope into another (pill / inline moves)
  const runRowMove = (fromId: string, toId: string) => {
    if (!toId) return;
    const from = b.envelopes.find((x) => x.id === fromId);
    const to = b.envelopes.find((x) => x.id === toId);
    if (!from || !to) return;
    const amount = Math.max(0, applyAmountInput(0, moveAmt));
    if (amount <= 0) return setMsg({ text: 'Enter an amount to move.', bad: true });
    if (amount > from.amount) return setMsg({ text: `${from.name} only has ${fmt(from.amount)} available.`, bad: true });
    set({ ...b, envelopes: moveMoney(b.envelopes, fromId, toId, amount) });
    setMovingId(null);
    setMsg({ text: `Moved ${fmt(amount)} from ${from.name} to ${to.name}.` });
  };

  const openMove = (e: Env) => {
    if (movingId === e.id) return setMovingId(null);
    setMovingId(e.id);
    setMoveAmt(String(Math.max(0, e.amount)));
  };

  // Cover overspending from a chosen source instead of guessing
  const handleCoverFrom = (envId: string, fromId: string) => {
    if (!fromId) return;
    const target = b.envelopes.find((e) => e.id === envId);
    const source = b.envelopes.find((e) => e.id === fromId);
    if (!target || !source) return;
    const take = Math.min(Math.abs(target.amount), source.amount);
    set({ ...b, envelopes: coverOverspent(b.envelopes, envId, fromId) });
    setMovingId(null);
    setMsg({ text: `Covered ${fmt(take)} of ${target.name} from ${source.name}.` });
  };

  const handleCover = (envId: string) => {
    const target = b.envelopes.find((e) => e.id === envId);
    if (!target) return;
    const next = coverOverspent(b.envelopes, envId);
    const after = next.find((e) => e.id === envId);
    const covered = Math.abs(target.amount) - Math.abs(Math.min(0, after?.amount ?? 0));
    set({ ...b, envelopes: next });
    setMovingId(null);
    setMsg(
      covered > 0
        ? { text: `Covered ${fmt(covered)} of ${target.name} from your lowest-priority envelopes.` }
        : { text: 'No envelope has money available to cover it.', bad: true }
    );
  };

  // Fund an underfunded envelope from Ready to Assign, else from the lowest-priority pool
  const handleFundDeficit = (envId: string, deficit: number) => {
    const targetEnv = b.envelopes.find((x) => x.id === envId);
    if (!targetEnv) return;
    if (rta > 0) {
      const take = Math.min(deficit, rta);
      updateEnv(envId, { assigned: targetEnv.assigned + take });
      setMsg({ text: `Assigned ${fmt(take)} to ${targetEnv.name}.` });
      return;
    }

    const pool = b.envelopes
      .filter((x) => x.id !== envId && x.amount > 0)
      .sort((a, c) => c.priority - a.priority || c.amount - a.amount);
    const source = pool[0];
    if (!source) {
      setMsg({ text: 'No unassigned cash or savings available to fund this envelope.', bad: true });
      return;
    }

    const take = Math.min(deficit, source.amount);
    set({ ...b, envelopes: moveMoney(b.envelopes, source.id, envId, take) });
    setMsg({ text: `Moved ${fmt(take)} from ${source.name} to fund ${targetEnv.name}.` });
  };

  // Reassign a transaction and keep spent / available in sync
  const handleReassignTxn = (txId: string, newEnvId: string) => {
    if (!newEnvId) return;
    const tx = b.transactions?.find((t) => t.id === txId);
    if (!tx || tx.amount >= 0 || tx.envelopeId === newEnvId) return;
    const cost = Math.abs(tx.amount);
    const oldEnvId = tx.envelopeId;

    set({
      ...b,
      envelopes: b.envelopes.map((e) => {
        let nextSpent = e.spent;
        if (e.id === oldEnvId) nextSpent -= cost;
        if (e.id === newEnvId) nextSpent += cost;
        return { ...e, spent: nextSpent, amount: e.assigned - nextSpent };
      }),
      transactions: b.transactions?.map((t) => (t.id === txId ? { ...t, envelopeId: newEnvId } : t)),
    });
    const dest = b.envelopes.find((e) => e.id === newEnvId);
    setMsg({ text: `Filed ${tx.desc} under ${dest?.name ?? 'that envelope'}.` });
  };

  const deleteTxn = (txId: string) => {
    const tx = b.transactions?.find((t) => t.id === txId);
    if (!tx) return;
    const cost = tx.amount;
    const nextCash = b.profile.cash - cost;
    const nextEnvs =
      tx.envelopeId && cost < 0
        ? b.envelopes.map((e) =>
            e.id === tx.envelopeId
              ? { ...e, spent: e.spent - Math.abs(cost), amount: e.assigned - (e.spent - Math.abs(cost)) }
              : e
          )
        : b.envelopes;
    set({
      ...b,
      profile: { ...b.profile, cash: nextCash },
      envelopes: nextEnvs,
      transactions: b.transactions?.filter((t) => t.id !== txId),
    });
    setMsg({ text: `Deleted ${tx.desc}.` });
  };

  // CSV import of fresh transactions
  const handleCsvImport = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const txns = extractCsvTxns(text);
      if (!txns.length) throw new Error('No transactions found in CSV.');
      let currentBudget = b;
      for (const t of txns) {
        const matched = matchEnvelope(t.desc, currentBudget.envelopes);
        currentBudget = recordTxn(currentBudget, {
          date: t.date,
          desc: t.desc,
          amount: t.amount,
          envelopeId: t.amount < 0 ? matched?.id : undefined,
        });
      }
      set(currentBudget);
      setShowTxns(true);
      setMsg({ text: `Imported ${txns.length} transactions from ${file.name}.` });
    } catch (err) {
      setMsg({ text: (err as Error).message, bad: true });
    }
  };

  const handleAddEnv = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnvName.trim()) return;
    const target = Math.max(0, parseFloat(newEnvTarget.replace(/,/g, '')) || 0);
    const newEnv: Env = {
      id: uid(),
      name: newEnvName.trim(),
      target,
      assigned: 0,
      spent: 0,
      amount: 0,
      priority: newEnvPriority,
    };
    set({ ...b, envelopes: [...b.envelopes, newEnv] });
    setMsg({ text: `Added ${newEnv.name}.` });
    setNewEnvName('');
    setNewEnvTarget('');
  };

  const saveCash = () => {
    const cash = Math.max(0, parseFloat(cashVal.replace(/,/g, '')) || 0);
    const profile = { ...b.profile, cash };
    // Pre-approval this is still "fill my envelopes"; afterwards it only corrects the balance.
    set({ ...b, profile, envelopes: b.approved ? b.envelopes : assign(profile) });
    setEditingCash(false);
    setMsg({ text: b.approved ? `Bank cash set to ${fmt(cash)}.` : `Cash set to ${fmt(cash)}. Envelopes refilled.` });
  };

  const doRoast = async () => {
    setRoastBusy(true);
    try {
      set({ ...b, roast: await roast(b.profile) });
    } finally {
      setRoastBusy(false);
    }
  };

  const priorityGroups = [1, 2, 3, 4, 5]
    .map((pNum) => {
      const envs = b.envelopes.filter((e) => e.priority === pNum);
      return {
        priority: pNum,
        label: PRIORITY_LABEL[pNum],
        envs,
        totalTarget: envs.reduce((s, e) => s + e.target, 0),
        totalAssigned: envs.reduce((s, e) => s + e.assigned, 0),
        totalSpent: envs.reduce((s, e) => s + e.spent, 0),
        totalAvailable: envs.reduce((s, e) => s + e.amount, 0),
      };
    })
    .filter((g) => g.envs.length > 0);

  const txns = (b.transactions || []).filter((t) => !filterEnv || t.envelopeId === filterEnv);
  const filterName = filterEnv ? b.envelopes.find((e) => e.id === filterEnv)?.name : null;

  return (
    <div className="budget-view">
      {!b.approved && (
        <section className="review-card">
          <h2 className="title">Here's where every dollar goes.</h2>
          <p className="fine">
            Edit any Target or Assigned cell — type <b>+50</b> or <b>-25</b> to nudge it. Rename a category or change its
            priority right in the row. Approve when the plan looks right.
          </p>
          <PlanNotes b={b} busy={roastBusy} onRoast={doRoast} />
          <div className="row end">
            <button className="go" disabled={!b.profile.cash} onClick={() => set({ ...b, approved: true })}>
              Approve plan
            </button>
          </div>
        </section>
      )}

      {/* Ready to Assign */}
      <div className={`rta-banner ${rta < 0 ? 'neg' : rta > 0 ? 'pos' : 'zero'}`}>
        <div className="rta-left">
          <span className="rta-label">{rta < 0 ? 'Overassigned' : 'Ready to Assign'}</span>
          <b className="rta-amt">{fmt(rta)}</b>
          {rta > 0 && totalUnderfunded > 0 && (
            <button className="auto-assign-btn" onClick={handleAutoAssign}>
              Auto-assign underfunded ({fmt(Math.min(rta, totalUnderfunded))})
            </button>
          )}
        </div>
        <div className="rta-right">
          <span className="cash-label">
            Total Cash in Bank: <b>{fmt(b.profile.cash)}</b>
          </span>
          <button className="ghost sm" onClick={() => setEditingCash(!editingCash)}>
            {editingCash ? 'Done' : 'Adjust'}
          </button>
        </div>
      </div>

      {editingCash && (
        <div className="cash-editor-row">
          <label>
            Set Total Bank Cash: $
            <input
              type="number"
              value={cashVal}
              onChange={(e) => setCashVal(e.target.value)}
              className="inline-input"
            />
          </label>
          <button className="go sm" onClick={saveCash}>
            {b.approved ? 'Save Cash' : 'Save & refill'}
          </button>
        </div>
      )}

      {/* Single command bar: moves, expenses and paychecks route automatically */}
      <div className="command-bar">
        <form className="cmd-form" onSubmit={handleCommand}>
          <span className="strip-title">COMMAND</span>
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder='Try "spent $42 on groceries", "got paid $2,200", or "move $50 from Fun to Groceries"'
            aria-label="Log a transaction or move money"
          />
          <button disabled={busyMove || !cmd.trim()} className="go sm">
            {busyMove ? '…' : 'Run'}
          </button>
          <button type="button" className="ghost sm" onClick={() => setManual(!manual)}>
            {manual ? 'Close' : '+ Transaction'}
          </button>
        </form>

        {manual && (
          <form className="manual-txn-form" onSubmit={handleManualTxn}>
            <select value={txIsInflow ? 'in' : 'out'} onChange={(e) => setTxIsInflow(e.target.value === 'in')} aria-label="Transaction type">
              <option value="out">Expense (-)</option>
              <option value="in">Inflow (+)</option>
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={txAmt}
              onChange={(e) => setTxAmt(e.target.value)}
              className="manual-amt"
              aria-label="Amount"
            />
            <input
              placeholder={txIsInflow ? 'Payee (e.g. Paycheck)' : 'Merchant (e.g. Trader Joe’s)'}
              value={txPayee}
              onChange={(e) => setTxPayee(e.target.value)}
              aria-label="Payee"
            />
            {!txIsInflow && (
              <select value={txEnvId} onChange={(e) => setTxEnvId(e.target.value)} aria-label="Category">
                <option value="">(Select Category)</option>
                {b.envelopes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({fmt(e.amount)})
                  </option>
                ))}
              </select>
            )}
            <button className="go sm">Save</button>
          </form>
        )}
      </div>

      {msg && (
        <p className={msg.bad ? 'err sm' : 'success-msg sm'} role={msg.bad ? 'alert' : 'status'}>
          {msg.text}
        </p>
      )}

      {overspentEnvs.length > 0 && (
        <div className="overspent-alert">
          <span>
            <b>
              {overspentEnvs.length} envelope{overspentEnvs.length > 1 ? 's' : ''} overspent
            </b>
            : {overspentEnvs.map((e) => `${e.name} (${fmt(e.amount)})`).join(', ')}
          </span>
          <button
            className="ghost sm red-btn"
            onClick={() => {
              let nextEnvs = b.envelopes;
              for (const oe of overspentEnvs) nextEnvs = coverOverspent(nextEnvs, oe.id);
              set({ ...b, envelopes: nextEnvs });
              setMsg({ text: 'Covered overspending from your lowest-priority envelopes.' });
            }}
          >
            Cover All Overspending
          </button>
        </div>
      )}

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th className="th-cat">CATEGORY</th>
              <th className="th-num">TARGET</th>
              <th className="th-num">ASSIGNED</th>
              <th className="th-num">SPENT</th>
              <th className="th-num">AVAILABLE</th>
              <th className="th-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {priorityGroups.map((g) => (
              <React.Fragment key={g.priority}>
                <tr className="group-row">
                  <td colSpan={1} className="group-name">
                    <b>{g.label}</b>
                    <small> ({g.envs.length})</small>
                  </td>
                  <td className="group-num">{fmt(g.totalTarget)}</td>
                  <td className="group-num">{fmt(g.totalAssigned)}</td>
                  <td className="group-num">{g.totalSpent > 0 ? `-${fmt(g.totalSpent)}` : '$0'}</td>
                  <td className="group-num">{fmt(g.totalAvailable)}</td>
                  <td></td>
                </tr>

                {g.envs.map((e) => {
                  const underfunded = Math.max(0, e.target - e.assigned);
                  const isOverspent = e.amount < 0;

                  return (
                    <React.Fragment key={e.id}>
                      <tr className={`env-row ${isOverspent ? 'row-overspent' : ''}`}>
                        <td className="td-cat">
                          <NameInput value={e.name} onCommit={(name) => updateEnv(e.id, { name })} />
                          <select
                            className="prio-select"
                            aria-label={`Priority for ${e.name}`}
                            value={e.priority}
                            onChange={(ev) => updateEnv(e.id, { priority: +ev.target.value })}
                          >
                            {[1, 2, 3, 4, 5].map((pNum) => (
                              <option key={pNum} value={pNum}>
                                {PRIORITY_LABEL[pNum]}
                              </option>
                            ))}
                          </select>
                          {underfunded > 0 && (
                            <button
                              className="underfunded-tag"
                              title={`Click to fund remaining ${fmt(underfunded)}`}
                              onClick={() => handleFundDeficit(e.id, underfunded)}
                            >
                              Needs {fmt(underfunded)}
                            </button>
                          )}
                        </td>

                        <td className="td-num">
                          <span className="currency">$</span>
                          <AmountInput
                            value={e.target}
                            label={`Target for ${e.name}`}
                            onCommit={(target) => updateEnv(e.id, { target })}
                          />
                        </td>

                        <td className="td-num">
                          <span className="currency">$</span>
                          <AmountInput
                            value={e.assigned}
                            label={`Assigned to ${e.name}`}
                            onCommit={(assigned) => updateEnv(e.id, { assigned })}
                          />
                        </td>

                        <td className="td-num td-spent">
                          {e.spent > 0 ? (
                            <button
                              type="button"
                              className="spent-btn"
                              title={`Show transactions for ${e.name}`}
                              onClick={() => {
                                setFilterEnv(e.id);
                                setShowTxns(true);
                              }}
                            >
                              -{fmt(e.spent)}
                            </button>
                          ) : (
                            '$0'
                          )}
                        </td>

                        <td className="td-num">
                          <button
                            type="button"
                            className={`avail-pill ${isOverspent ? 'pill-neg' : e.amount > 0 ? 'pill-pos' : 'pill-zero'}`}
                            title={isOverspent ? 'Cover this overspending from another envelope' : 'Move this money to another envelope'}
                            onClick={() => openMove(e)}
                          >
                            {fmt(e.amount)}
                          </button>
                        </td>

                        <td className="td-actions">
                          <button
                            className="row-del-btn"
                            title={`Delete ${e.name}`}
                            onClick={() => confirm(`Delete ${e.name}?`) && deleteEnv(e.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>

                      {movingId === e.id && (
                        <tr className="move-row">
                          <td colSpan={6}>
                            {isOverspent ? (
                              <div className="move-form">
                                <span>
                                  Cover {fmt(Math.abs(e.amount))} of {e.name} from
                                </span>
                                <select
                                  value=""
                                  aria-label={`Cover ${e.name} from which envelope`}
                                  onChange={(ev) => handleCoverFrom(e.id, ev.target.value)}
                                >
                                  <option value="">Choose envelope…</option>
                                  {b.envelopes
                                    .filter((x) => x.id !== e.id && x.amount > 0)
                                    .map((x) => (
                                      <option key={x.id} value={x.id}>
                                        {x.name} ({fmt(x.amount)})
                                      </option>
                                    ))}
                                </select>
                                <button type="button" className="ghost sm" onClick={() => handleCover(e.id)}>
                                  Lowest priority first
                                </button>
                                <button type="button" className="ghost sm" onClick={() => setMovingId(null)}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="move-form">
                                <span>Move $</span>
                                <input
                                  className="move-amt"
                                  inputMode="decimal"
                                  value={moveAmt}
                                  onChange={(ev) => setMoveAmt(ev.target.value)}
                                  aria-label="Amount to move"
                                />
                                <span>from {e.name} to</span>
                                <select
                                  value=""
                                  aria-label={`Move ${e.name} money to which envelope`}
                                  onChange={(ev) => runRowMove(e.id, ev.target.value)}
                                >
                                  <option value="">Choose envelope…</option>
                                  {b.envelopes
                                    .filter((x) => x.id !== e.id)
                                    .map((x) => (
                                      <option key={x.id} value={x.id}>
                                        {x.name} ({fmt(x.amount)})
                                      </option>
                                    ))}
                                </select>
                                <button type="button" className="ghost sm" onClick={() => setMovingId(null)}>
                                  Cancel
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="add-env-row">
              <td colSpan={6}>
                <form className="add-env-form" onSubmit={handleAddEnv}>
                  <span className="strip-title">NEW</span>
                  <input
                    placeholder="Envelope name"
                    value={newEnvName}
                    onChange={(e) => setNewEnvName(e.target.value)}
                    aria-label="New envelope name"
                  />
                  <span className="currency">$</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="Target"
                    className="new-target"
                    value={newEnvTarget}
                    onChange={(e) => setNewEnvTarget(e.target.value)}
                    aria-label="New envelope target"
                  />
                  <select
                    value={newEnvPriority}
                    onChange={(e) => setNewEnvPriority(+e.target.value)}
                    aria-label="New envelope priority"
                  >
                    {[1, 2, 3, 4, 5].map((i) => (
                      <option key={i} value={i}>
                        {PRIORITY_LABEL[i]}
                      </option>
                    ))}
                  </select>
                  <button className="go sm" disabled={!newEnvName.trim()}>
                    Add envelope
                  </button>
                </form>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Ledger: open by default, filterable from the SPENT column */}
      <div className="txns-section">
        <div className="txns-header">
          <h3>Transactions ({txns.length})</h3>
          <div className="txns-tools">
            {filterName && (
              <button className="chip" onClick={() => setFilterEnv(null)} title="Clear category filter">
                Showing: {filterName} ×
              </button>
            )}
            <button className="ghost sm" onClick={() => csvFileRef.current?.click()}>
              Import CSV
            </button>
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => handleCsvImport(e.target.files?.[0])}
            />
            <button className="ghost sm" onClick={() => setShowTxns(!showTxns)}>
              {showTxns ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {showTxns && (
          <div className="txns-list">
            {txns.length === 0 ? (
              <p className="fine">
                {filterEnv
                  ? 'No transactions filed under this envelope yet.'
                  : 'No transactions logged yet. Use the command bar above or import a CSV statement.'}
              </p>
            ) : (
              <table className="mini-txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="mini-amt">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((tx) => (
                    <tr key={tx.id} className={tx.id === flashTx ? 'txn-new' : ''}>
                      <td>{tx.date}</td>
                      <td>{tx.desc}</td>
                      <td>
                        {tx.amount > 0 ? (
                          <span className="txn-rta">Ready to Assign</span>
                        ) : (
                          <select
                            className="txn-cat-select"
                            value={tx.envelopeId || ''}
                            aria-label={`Category for ${tx.desc}`}
                            onChange={(ev) => handleReassignTxn(tx.id, ev.target.value)}
                          >
                            {!tx.envelopeId && <option value="" disabled>Uncategorized</option>}
                            {b.envelopes.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className={`mini-amt ${tx.amount > 0 ? 'txn-in' : ''}`}>
                        {tx.amount > 0 ? `+${fmt(tx.amount)}` : `-${fmt(Math.abs(tx.amount))}`}
                      </td>
                      <td className="mini-del">
                        <button className="row-del-btn" title="Delete transaction" onClick={() => deleteTxn(tx.id)}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {b.log && b.log.length > 0 && (
              <div className="txn-history">
                <h4>Impulse / Reality Check History ({b.log.length})</h4>
                {b.log
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <div key={entry.at} className="r">
                      <span>
                        {entry.kind === 'buy' ? 'Bought anyway' : 'Saved instead'}: {entry.label}
                      </span>
                      <span>{fmt(entry.price)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {b.approved && (
        <details className="plan-notes">
          <summary>Plan notes &amp; subscriptions</summary>
          <PlanNotes b={b} busy={roastBusy} onRoast={doRoast} />
        </details>
      )}
    </div>
  );
}

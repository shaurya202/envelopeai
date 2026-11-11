import React, { useRef, useState } from 'react';
import type { Budget, Env } from './types';
import { adjust } from './ai';
import {
  PRIORITY_LABEL,
  autoAssignUnderfunded,
  coverOverspent,
  fmt,
  parseQuickTxn,
  readyToAssign,
  recordTxn,
  uid,
} from './money';
import { extractCsvTxns } from './parse';

type P = { b: Budget; set: (b: Budget) => void };

export function Envelopes({ b, set }: P) {
  // Command & Move state
  const [moveCmd, setMoveCmd] = useState('');
  const [moveErr, setMoveErr] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);

  // Quick transaction state
  const [txnInput, setTxnInput] = useState('');
  const [manualTxn, setManualTxn] = useState(false);
  const [txPayee, setTxPayee] = useState('');
  const [txAmt, setTxAmt] = useState('');
  const [txEnvId, setTxEnvId] = useState<string>('');
  const [txIsInflow, setTxIsInflow] = useState(false);
  const [txMsg, setTxMsg] = useState('');
  const csvFileRef = useRef<HTMLInputElement>(null);

  // New envelope state
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvTarget, setNewEnvTarget] = useState('');
  const [newEnvPriority, setNewEnvPriority] = useState(4);

  // Cash on hand modal / edit
  const [editingCash, setEditingCash] = useState(false);
  const [cashVal, setCashVal] = useState(b.profile.cash.toString());

  // Show transactions drawer
  const [showTxns, setShowTxns] = useState(false);

  const rta = readyToAssign(b);
  const totalUnderfunded = b.envelopes.reduce((s, e) => s + Math.max(0, e.target - e.assigned), 0);
  const overspentEnvs = b.envelopes.filter((e) => e.amount < 0);

  // Update envelope assigned or target
  const updateEnv = (id: string, updates: Partial<Env>) => {
    set({
      ...b,
      envelopes: b.envelopes.map((e) => {
        if (e.id !== id) return e;
        const nextAssigned = updates.assigned !== undefined ? updates.assigned : e.assigned;
        const nextSpent = updates.spent !== undefined ? updates.spent : e.spent;
        return {
          ...e,
          ...updates,
          assigned: nextAssigned,
          spent: nextSpent,
          amount: nextAssigned - nextSpent,
        };
      }),
    });
  };

  const deleteEnv = (id: string) => {
    set({ ...b, envelopes: b.envelopes.filter((e) => e.id !== id) });
  };

  // Roll with the punches: Move money
  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveCmd.trim()) return;
    setMoveBusy(true);
    setMoveErr('');
    try {
      let envs = b.envelopes;
      const moves = await adjust(moveCmd, envs);
      for (const m of moves) {
        const from = envs.find((x) => x.name.toLowerCase() === m.from.toLowerCase());
        const to = envs.find((x) => x.name.toLowerCase() === m.to.toLowerCase());
        if (!from || !to) throw new Error(`Could not find "${!from ? m.from : m.to}".`);
        const amt = Math.min(m.amount, from.assigned);
        envs = envs.map((x) => {
          if (x.id === from.id) {
            const nextAssigned = x.assigned - amt;
            return { ...x, assigned: nextAssigned, amount: nextAssigned - x.spent };
          }
          if (x.id === to.id) {
            const nextAssigned = x.assigned + amt;
            return { ...x, assigned: nextAssigned, amount: nextAssigned - x.spent };
          }
          return x;
        });
      }
      set({ ...b, envelopes: envs });
      setMoveCmd('');
    } catch (err) {
      setMoveErr((err as Error).message);
    } finally {
      setMoveBusy(false);
    }
  };

  // Auto-assign underfunded
  const handleAutoAssign = () => {
    if (rta <= 0) return;
    const { envs } = autoAssignUnderfunded(b.envelopes, rta);
    set({ ...b, envelopes: envs });
  };

  // Quick cover overspent
  const handleCover = (envId: string) => {
    set({ ...b, envelopes: coverOverspent(b.envelopes, envId) });
  };

  // Quick transaction / paycheck entry
  const handleLogTxn = (e: React.FormEvent) => {
    e.preventDefault();
    setTxMsg('');

    if (manualTxn) {
      const amt = parseFloat(txAmt.replace(/,/g, ''));
      if (isNaN(amt) || amt <= 0) return setTxMsg('Enter a valid amount.');
      const finalAmt = txIsInflow ? amt : -amt;
      const desc = txPayee.trim() || (txIsInflow ? 'Paycheck' : 'Expense');
      set(recordTxn(b, { desc, amount: finalAmt, envelopeId: txIsInflow ? undefined : txEnvId || undefined }));
      setTxAmt('');
      setTxPayee('');
      setManualTxn(false);
      setTxMsg(`Logged ${fmt(amt)} for ${desc}`);
      return;
    }

    const parsed = parseQuickTxn(txnInput, b.envelopes);
    if (!parsed) {
      return setTxMsg('Try "spent $42 on groceries" or "got paid $2,200".');
    }

    set(recordTxn(b, parsed));
    setTxnInput('');
    setTxMsg(`Logged ${parsed.amount > 0 ? '+' : ''}${fmt(parsed.amount)}: ${parsed.desc}`);
  };

  // CSV Import of fresh transactions
  const handleCsvImport = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const txns = extractCsvTxns(text);
      if (!txns.length) throw new Error('No transactions found in CSV.');
      let currentBudget = b;
      for (const t of txns) {
        // match category by description
        const matched = currentBudget.envelopes.find((e) =>
          t.desc.toLowerCase().includes(e.name.toLowerCase()) || e.name.toLowerCase().includes(t.desc.toLowerCase())
        );
        currentBudget = recordTxn(currentBudget, {
          date: t.date,
          desc: t.desc,
          amount: t.amount,
          envelopeId: t.amount < 0 ? matched?.id : undefined,
        });
      }
      set(currentBudget);
      setTxMsg(`Imported ${txns.length} transactions from ${file.name}!`);
    } catch (err) {
      setTxMsg((err as Error).message);
    }
  };

  // Add new envelope
  const handleAddEnv = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnvName.trim()) return;
    const target = parseFloat(newEnvTarget.replace(/,/g, '')) || 0;
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
    setNewEnvName('');
    setNewEnvTarget('');
  };

  // Group envelopes by priority 1..5
  const priorityGroups = [1, 2, 3, 4, 5].map((pNum) => {
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
  }).filter((g) => g.envs.length > 0);

  return (
    <div className="budget-view">
      {/* 1. Ready to Assign Bar */}
      <div className={`rta-banner ${rta < 0 ? 'neg' : rta > 0 ? 'pos' : 'zero'}`}>
        <div className="rta-left">
          <span className="rta-label">
            {rta < 0 ? 'Overassigned' : 'Ready to Assign'}
          </span>
          <b className="rta-amt">{fmt(rta)}</b>
          {rta > 0 && totalUnderfunded > 0 && (
            <button className="auto-assign-btn" onClick={handleAutoAssign}>
              ⚡ Auto-Assign Underfunded ({fmt(Math.min(rta, totalUnderfunded))})
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
          <button
            className="go sm"
            onClick={() => {
              const val = parseFloat(cashVal) || 0;
              set({ ...b, profile: { ...b.profile, cash: Math.max(0, val) } });
              setEditingCash(false);
            }}
          >
            Save Cash
          </button>
        </div>
      )}

      {/* Overspent Warning Alert */}
      {overspentEnvs.length > 0 && (
        <div className="overspent-alert">
          <span>
            ⚠️ <b>{overspentEnvs.length} envelope{overspentEnvs.length > 1 ? 's' : ''} overspent</b>: {overspentEnvs.map((e) => `${e.name} (${fmt(e.amount)})`).join(', ')}
          </span>
          <button className="ghost sm red-btn" onClick={() => {
            let nextEnvs = b.envelopes;
            for (const oe of overspentEnvs) nextEnvs = coverOverspent(nextEnvs, oe.id);
            set({ ...b, envelopes: nextEnvs });
          }}>
            Cover All Overspending
          </button>
        </div>
      )}

      {/* 2. Living Move Bar ("Roll with the Punches") */}
      <div className="action-strip">
        <form className="move-strip" onSubmit={handleMove}>
          <span className="strip-title">MOVE</span>
          <input
            value={moveCmd}
            onChange={(e) => setMoveCmd(e.target.value)}
            placeholder='e.g. "move $50 from Fun to Groceries"'
            disabled={moveBusy}
          />
          <button disabled={moveBusy || !moveCmd.trim()} className="go sm">
            {moveBusy ? '…' : 'Move'}
          </button>
        </form>

        {/* 3. Transaction / Inflow Bar */}
        <form className="txn-strip" onSubmit={handleLogTxn}>
          <span className="strip-title">LOG</span>
          {!manualTxn ? (
            <>
              <input
                value={txnInput}
                onChange={(e) => setTxnInput(e.target.value)}
                placeholder='e.g. "spent $42 on groceries" or "got paid $2,200"'
              />
              <button disabled={!txnInput.trim()} className="go sm">
                Record
              </button>
              <button type="button" className="ghost sm" onClick={() => setManualTxn(true)}>
                Manual
              </button>
            </>
          ) : (
            <div className="manual-inputs">
              <select value={txIsInflow ? 'in' : 'out'} onChange={(e) => setTxIsInflow(e.target.value === 'in')}>
                <option value="out">Expense (-)</option>
                <option value="in">Inflow (+)</option>
              </select>
              <input
                type="number"
                placeholder="Amount"
                value={txAmt}
                onChange={(e) => setTxAmt(e.target.value)}
                style={{ width: '6rem' }}
              />
              <input
                placeholder={txIsInflow ? 'Payee (e.g. Paycheck)' : 'Merchant (e.g. Trader Joe’s)'}
                value={txPayee}
                onChange={(e) => setTxPayee(e.target.value)}
              />
              {!txIsInflow && (
                <select value={txEnvId} onChange={(e) => setTxEnvId(e.target.value)}>
                  <option value="">(Select Category)</option>
                  {b.envelopes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({fmt(e.amount)})
                    </option>
                  ))}
                </select>
              )}
              <button className="go sm">Save</button>
              <button type="button" className="ghost sm" onClick={() => setManualTxn(false)}>
                Cancel
              </button>
            </div>
          )}
          <button type="button" className="ghost sm" onClick={() => csvFileRef.current?.click()}>
            📎 CSV
          </button>
          <input
            ref={csvFileRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => handleCsvImport(e.target.files?.[0])}
          />
        </form>
      </div>

      {moveErr && <p className="err sm" role="alert">{moveErr}</p>}
      {txMsg && <p className="success-msg sm">{txMsg}</p>}

      {/* 4. Table / Priority Group Ledger View */}
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
                  <td className="group-num">{fmt(g.totalSpent)}</td>
                  <td className="group-num">{fmt(g.totalAvailable)}</td>
                  <td></td>
                </tr>

                {g.envs.map((e) => {
                  const underfunded = Math.max(0, e.target - e.assigned);
                  const isOverspent = e.amount < 0;

                  return (
                    <tr key={e.id} className={`env-row ${isOverspent ? 'row-overspent' : ''}`}>
                      <td className="td-cat">
                        <span className="env-title">{e.name}</span>
                        {underfunded > 0 && (
                          <button
                            className="underfunded-tag"
                            title={`Click to fund remaining ${fmt(underfunded)}`}
                            onClick={() => {
                              const canFund = rta > 0 ? Math.min(underfunded, rta) : underfunded;
                              updateEnv(e.id, { assigned: e.assigned + canFund });
                            }}
                          >
                            Needs {fmt(underfunded)}
                          </button>
                        )}
                      </td>

                      {/* Target Input */}
                      <td className="td-num">
                        $<input
                          type="number"
                          className="table-input"
                          min={0}
                          value={e.target || ''}
                          placeholder="0"
                          onChange={(ev) => updateEnv(e.id, { target: Math.max(0, +ev.target.value) })}
                        />
                      </td>

                      {/* Assigned Input */}
                      <td className="td-num">
                        $<input
                          type="number"
                          className="table-input"
                          min={0}
                          value={e.assigned || ''}
                          placeholder="0"
                          onChange={(ev) => updateEnv(e.id, { assigned: Math.max(0, +ev.target.value) })}
                        />
                      </td>

                      {/* Spent Display */}
                      <td className="td-num td-spent">
                        {e.spent > 0 ? `-${fmt(e.spent)}` : '$0'}
                      </td>

                      {/* Available Pill */}
                      <td className="td-num">
                        <span className={`avail-pill ${isOverspent ? 'pill-neg' : e.amount > 0 ? 'pill-pos' : 'pill-zero'}`}>
                          {fmt(e.amount)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="td-actions">
                        {isOverspent && (
                          <button
                            className="cover-btn"
                            title="Cover deficit from lowest priority envelope"
                            onClick={() => handleCover(e.id)}
                          >
                            Cover
                          </button>
                        )}
                        <button
                          className="row-del-btn"
                          title={`Delete ${e.name}`}
                          onClick={() => confirm(`Delete ${e.name}?`) && deleteEnv(e.id)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add New Envelope Form */}
      <form className="add-env-strip" onSubmit={handleAddEnv}>
        <span className="strip-title">+ ENVELOPE</span>
        <input
          placeholder="Envelope Name (e.g. Car Maintenance)"
          value={newEnvName}
          onChange={(e) => setNewEnvName(e.target.value)}
        />
        <input
          type="number"
          placeholder="Monthly Target ($)"
          value={newEnvTarget}
          onChange={(e) => setNewEnvTarget(e.target.value)}
          style={{ width: '8rem' }}
        />
        <select value={newEnvPriority} onChange={(e) => setNewEnvPriority(+e.target.value)}>
          {[1, 2, 3, 4, 5].map((i) => (
            <option key={i} value={i}>
              {PRIORITY_LABEL[i]}
            </option>
          ))}
        </select>
        <button className="go sm">Add Envelope</button>
      </form>

      {/* Recent Transactions Section */}
      <div className="txns-section">
        <div className="txns-header">
          <h3>
            Recent Transactions ({b.transactions?.length || 0})
          </h3>
          <button className="ghost sm" onClick={() => setShowTxns(!showTxns)}>
            {showTxns ? 'Hide' : 'Show Ledger'}
          </button>
        </div>

        {showTxns && (
          <div className="txns-list">
            {(!b.transactions || b.transactions.length === 0) ? (
              <p className="fine">No transactions logged yet. Use the LOG bar above or import a CSV statement.</p>
            ) : (
              <table className="mini-txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {b.transactions.map((tx) => {
                    const matchedEnv = b.envelopes.find((e) => e.id === tx.envelopeId);
                    return (
                      <tr key={tx.id}>
                        <td>{tx.date}</td>
                        <td>{tx.desc}</td>
                        <td>{matchedEnv ? matchedEnv.name : tx.amount > 0 ? 'Ready to Assign' : 'Uncategorized'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', color: tx.amount > 0 ? 'var(--blue)' : 'var(--ink)' }}>
                          {tx.amount > 0 ? `+${fmt(tx.amount)}` : `-${fmt(Math.abs(tx.amount))}`}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="row-del-btn"
                            title="Delete transaction"
                            onClick={() => {
                              // Reversing transaction
                              const cost = tx.amount;
                              const nextCash = b.profile.cash - cost;
                              const nextEnvs = tx.envelopeId && cost < 0
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
                                transactions: b.transactions?.filter((t) => t.id !== tx.id),
                              });
                            }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

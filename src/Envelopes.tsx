import { useState } from 'react';
import type { Budget } from './types';
import { PRIORITY_LABEL, fmt, uid } from './money';

type P = { b: Budget; set: (b: Budget) => void };

export function Envelopes({ b, set }: P) {
  const [name, setName] = useState('');
  const assigned = b.envelopes.reduce((s, e) => s + e.amount, 0);
  const free = b.profile.cash - assigned;
  const edit = (id: string, amount: number) => set({ ...b, envelopes: b.envelopes.map((e) => (e.id === id ? { ...e, amount } : e)) });

  return (
    <>
      <div className={'free' + (free < 0 ? ' neg' : '')}>
        <span>{free < 0 ? 'Overassigned by' : 'Unassigned'}</span><b>{fmt(Math.abs(free))}</b>
      </div>
      <div className="grid">
        {b.envelopes.map((e) => (
          <article className="env" key={e.id}>
            <header><h3>{e.name}</h3><button aria-label={`Delete ${e.name}`} onClick={() => set({ ...b, envelopes: b.envelopes.filter((x) => x.id !== e.id) })}>×</button></header>
            <label>$<input type="number" min={0} value={e.amount} onChange={(ev) => edit(e.id, Math.max(0, +ev.target.value))} aria-label={`${e.name} amount`} /></label>
            <select value={e.priority} onChange={(ev) => set({ ...b, envelopes: b.envelopes.map((x) => (x.id === e.id ? { ...x, priority: +ev.target.value } : x)) })} aria-label={`${e.name} priority`}>
              {[1, 2, 3, 4, 5].map((i) => <option key={i} value={i}>{PRIORITY_LABEL[i]}</option>)}
            </select>
          </article>
        ))}
        <form className="env add" onSubmit={(ev) => { ev.preventDefault(); if (name.trim()) { set({ ...b, envelopes: [...b.envelopes, { id: uid(), name: name.trim(), amount: 0, priority: 4 }] }); setName(''); } }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New envelope, e.g. Japan trip" aria-label="New envelope name" />
          <button>Add</button>
        </form>
      </div>
      {b.log.length > 0 && (
        <section className="note"><h3>History</h3>
          {[...b.log].reverse().map((l) => <div key={l.at} className="r"><span>{l.kind === 'buy' ? 'Bought' : 'Saved instead'}: {l.label}</span><span>{fmt(l.price)}</span></div>)}
        </section>
      )}
    </>
  );
}

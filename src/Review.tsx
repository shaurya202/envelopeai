import { useState } from 'react';
import type { Budget } from './types';
import { adjust, roast } from './ai';
import { PRIORITY_LABEL, assign, fmt } from './money';

type P = { b: Budget; set: (b: Budget) => void };

export function Review({ b, set, onReset }: P & { onReset: () => void }) {
  const [ask, setAsk] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const p = b.profile;

  const setCash = (cash: number) => set({ ...b, profile: { ...p, cash }, envelopes: assign({ ...p, cash }) });
  const tell = async () => {
    setMsg('');
    try {
      let envs = b.envelopes;
      for (const m of await adjust(ask, envs)) {
        const [from, to] = [envs.find((e) => e.name === m.from), envs.find((e) => e.name === m.to)];
        if (!from || !to) throw new Error(`No envelope called "${!from ? m.from : m.to}".`);
        const amt = Math.min(m.amount, from.amount);
        envs = envs.map((e) =>
          e === from
            ? { ...e, assigned: e.assigned - amt, amount: e.amount - amt }
            : e === to
            ? { ...e, assigned: e.assigned + amt, amount: e.amount + amt }
            : e
        );
      }
      set({ ...b, envelopes: envs }); setAsk('');
    } catch (e) { setMsg((e as Error).message); }
  };
  const doRoast = async () => { setBusy(true); set({ ...b, roast: await roast(p) }); setBusy(false); };

  return (
    <div className="shell narrow">
      <h2 className="title">Here's where every dollar goes.</h2>
      <label className="cash">Money on hand
        <input type="number" min={0} value={p.cash || ''} placeholder="0" onChange={(e) => setCash(Math.max(0, +e.target.value))} />
      </label>
      {!p.cash && <p className="err">No balance found. Enter what's in your account and I'll fill the envelopes.</p>}

      <ul className="ledger airmail">
        {b.envelopes.map((e) => (
          <li key={e.id}><span>{e.name}<small>{PRIORITY_LABEL[e.priority]}</small></span><b>{fmt(e.amount)}</b></li>
        ))}
      </ul>

      {p.subs.length > 0 && (
        <section className="note">
          <h3>Subscriptions I caught</h3>
          {p.subs.map((s) => <div key={s.name} className="r"><span>{s.name}</span><span>{fmt(s.monthly)}/mo</span></div>)}
          <div className="r tot"><span>That's</span><span>{fmt(Math.round(p.subs.reduce((t, s) => t + s.monthly, 0) * 12))}/yr</span></div>
        </section>
      )}
      {p.income && <p className="fine">Next paycheck: {fmt(p.income.amount)}, {p.income.when}.</p>}

      {b.roast && <blockquote className="roast">{b.roast}</blockquote>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); tell(); }}>
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder='Tell me what to move: "move $100 from Fun to Savings"' />
        <button disabled={!ask.trim()}>Move</button>
      </form>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="row end">
        <button className="ghost" onClick={onReset}>Start over</button>
        <button className="ghost" disabled={busy} onClick={doRoast}>{busy ? 'Roasting…' : 'Roast my statement'}</button>
        <button className="go" disabled={!p.cash} onClick={() => set({ ...b, approved: true })}>Approve plan</button>
      </div>
    </div>
  );
}

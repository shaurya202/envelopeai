import { useState } from 'react';
import type { Budget } from './types';
import { verdictLine } from './ai';
import { ageOfMoney, applyMoves, assess, fmt, parseAsk, pullPlan } from './money';

type P = { b: Budget; set: (b: Budget) => void };
type Result = ReturnType<typeof assess> & { quip: string };

export function Afford({ b, set }: P) {
  const [q, setQ] = useState('');
  const [r, setR] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const a = parseAsk(q);
    if (!a) return setErr('Include a price, like "PS5 Pro $700".');
    setErr(''); setBusy(true);
    const x = assess(b, a.label, a.price);
    setR({ ...x, quip: await verdictLine(a.label, a.price, x.lines) });
    setBusy(false);
  };

  const finish = (kind: 'buy' | 'save') => {
    if (!r) return;
    const lines = [...r.lines];
    let envelopes, cash = b.profile.cash;
    if (kind === 'buy') { envelopes = applyMoves(b.envelopes, r.pulls); cash -= r.price; }
    else {
      const p = pullPlan(b.envelopes.filter((e) => e.priority >= 3), r.price, 'Savings') // never raid bills or essentials;
      envelopes = applyMoves(b.envelopes, p.pulls, 'Savings');
      lines.splice(0, lines.length, `moved ${fmt(Math.round(r.price - p.short))} into Savings`, 'Age of Money intact');
    }
    set({ ...b, envelopes, profile: { ...b.profile, cash }, log: [...b.log, { at: Date.now(), kind, label: `${r.label} ${fmt(r.price)}`, price: r.price, lines }] });
    setR(null); setQ('');
  };

  const stamp = r && { NOPE: 'stamp-no', HMM: 'stamp-hmm', FINE: 'stamp-ok' }[r.verdict];
  return (
    <div className="narrow">
      <form className="row ask" onSubmit={(e) => { e.preventDefault(); check(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Weekend in Austin $600" aria-label="What are you tempted to buy?" autoFocus />
        <button className="go" disabled={busy || !q.trim()}>{busy ? '…' : 'Can I?'}</button>
      </form>
      {err && <p className="err" role="alert">{err}</p>}
      {r && (
        <section className="note verdict">
          <div className={'vstamp ' + stamp}>{r.verdict}</div>
          <h3>{r.label}, {fmt(r.price)}</h3>
          <p className="quip">{r.quip}</p>
          <ul>{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="fine">Age of Money: {ageOfMoney(b.profile)} → {ageOfMoney(b.profile, b.profile.cash - r.price)} days</p>
          {r.short > 0 && <p className="err">You're {fmt(Math.round(r.short))} short even after emptying every envelope.</p>}
          <div className="row end">
            <button className="ghost" disabled={r.short > 0} onClick={() => finish('buy')}>Buy it anyway</button>
            <button className="go" onClick={() => finish('save')}>Save me from myself</button>
          </div>
        </section>
      )}
    </div>
  );
}

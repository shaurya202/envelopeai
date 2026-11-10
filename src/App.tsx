import { useEffect, useRef, useState } from 'react';
import type { Budget } from './types';
import { assign } from './money';
import { readSource, aiConfigured } from './ai';
import { Envelopes } from './Envelopes';
import { Afford } from './Afford';
import { Receipt } from './Receipt';
import { Review } from './Review';

const KEY = 'envelopeai:v1';
const load = (): Budget | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };

export default function App() {
  const [b, setB] = useState<Budget | null>(load);
  const [tab, setTab] = useState<'env' | 'afford' | 'receipt'>('env');
  const fileIn = useRef<HTMLInputElement>(null);
  useEffect(() => { b ? localStorage.setItem(KEY, JSON.stringify(b)) : localStorage.removeItem(KEY); }, [b]);

  if (!b) return <Home onDone={(profile) => setB({ profile, envelopes: assign(profile), log: [], approved: false })} />;
  if (!b.approved) return <Review b={b} set={setB} onReset={() => setB(null)} />;

  const download = (name: string, body: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name; a.click();
  };
  const importJson = async (f?: File) => {
    if (!f) return;
    try { const j = JSON.parse(await f.text()); if (!j.profile || !j.envelopes) throw 0; setB(j); } catch { alert('That is not an EnvelopeAI export.'); }
  };

  return (
    <div className="shell">
      <header className="bar">
        <h1>Envelope<span>AI</span></h1>
        <nav>
          {([['env', 'Envelopes'], ['afford', 'Can I afford it?'], ['receipt', 'Receipt']] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
        <div className="tools">
          <button onClick={() => download('envelopeai.json', JSON.stringify(b, null, 1), 'application/json')}>Export</button>
          <button onClick={() => fileIn.current?.click()}>Import</button>
          <button onClick={() => download('envelopes.csv', 'envelope,amount\n' + b.envelopes.map((e) => `"${e.name}",${e.amount}`).join('\n'), 'text/csv')}>CSV</button>
          <button onClick={() => confirm('Erase everything stored in this browser?') && setB(null)}>Reset</button>
          <input ref={fileIn} type="file" accept=".json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
        </div>
      </header>
      <main>
        {tab === 'env' && <Envelopes b={b} set={setB} />}
        {tab === 'afford' && <Afford b={b} set={setB} />}
        {tab === 'receipt' && <Receipt b={b} />}
      </main>
    </div>
  );
}

function Home({ onDone }: { onDone: (p: Awaited<ReturnType<typeof readSource>>) => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  const go = async () => {
    setBusy(true); setErr('');
    try { onDone(await readSource(text, file)); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div className="home">
      <p className="kicker">Stop paying YNAB $109/year to budget your own money.</p>
      <div className={'letter airmail' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); setFile(e.dataTransfer.files[0]); }}>
        <div className="stamp"><b>FREE</b><i>no signup</i></div>
        <div className="postmark" aria-hidden>LOCAL<br />ONLY<br />•••</div>
        <h1>Drop anything.<br />Get funded envelopes.</h1>
        <label className="addr">
          <span>Tell me about your money:</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
            placeholder={'I have $1,900 in checking, rent is $1,400 on the 1st, and I get paid $2,200 on Friday'} />
        </label>
        <div className="row">
          <button className="ghost" onClick={() => pick.current?.click()}>{file ? `📎 ${file.name}` : 'or drop a bank statement / YNAB export'}</button>
          {file && <button className="x" onClick={() => setFile(undefined)} aria-label="Remove file">×</button>}
          <input ref={pick} type="file" accept=".csv,.txt,.pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0])} />
          <button className="go" disabled={busy || (!text.trim() && !file)} onClick={go}>{busy ? 'Reading…' : 'Fill my envelopes →'}</button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      <p className="fine">Your data never leaves this browser except what you ask the AI to read. {aiConfigured ? '' : 'AI offline: running on local heuristics.'}</p>
    </div>
  );
}

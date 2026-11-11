import { useEffect, useRef, useState } from 'react';
import type { Budget } from './types';
import { Envelopes } from './Envelopes';
import { Afford } from './Afford';
import { Receipt } from './Receipt';
import { PublikCard } from './PublikCard';
import { Onboarding } from './Onboarding';

const KEY = 'envelopeai:v1';
const load = (): Budget | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};

export default function App() {
  const [b, setB] = useState<Budget | null>(load);
  const [tab, setTab] = useState<'env' | 'afford' | 'receipt'>('env');
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    b ? localStorage.setItem(KEY, JSON.stringify(b)) : localStorage.removeItem(KEY);
  }, [b]);

  if (!b) {
    return <Onboarding onDone={(newBudget) => setB(newBudget)} />;
  }

  const download = (name: string, body: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name;
    a.click();
  };

  const importJson = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j.profile || !j.envelopes) throw 0;
      setB(j);
    } catch {
      alert('That is not an EnvelopeAI export.');
    }
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
        <PublikCard />
      </main>
    </div>
  );
}

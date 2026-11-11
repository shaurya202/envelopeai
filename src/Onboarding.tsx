import { useRef, useState } from 'react';
import type { Budget, Env, Profile } from './types';
import { assign, fmt, PRIORITY_LABEL } from './money';
import { adjust, readSource, roast, aiConfigured } from './ai';
import { PublikCard } from './PublikCard';

interface OnboardingProps {
  onDone: (b: Budget) => void;
}

const PRESETS = [
  {
    label: 'Paycheck-to-Paycheck',
    desc: '$1,900 checking, $1,400 rent on 1st, $2,200 payday Friday',
    text: 'I have $1,900 in checking, rent is $1,400 on the 1st, and I get paid $2,200 on Friday',
  },
  {
    label: 'Freelancer / Gig',
    desc: '$3,200 cash, $1,100 rent, $120 internet, health ins $210',
    text: 'I have $3,200 in checking, rent is $1,100 on the 1st, health insurance is $210, internet is $120, and I expect $1,800 next week',
  },
  {
    label: 'Recent Grad',
    desc: '$850 checking, $500 rent share, student loan $150',
    text: 'I have $850 in checking, rent is $500 on the 1st, student loan is $150, and I get paid $1,100 next Thursday',
  },
];

export function Onboarding({ onDone }: OnboardingProps) {
  // Step 1: 'input' | Step 2: 'review' | Step 3: 'primer'
  const [step, setStep] = useState<'input' | 'review' | 'primer'>('input');
  const [activeTab, setActiveTab] = useState<'text' | 'file'>('text');

  // Input state
  const [text, setText] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Review state
  const [profile, setProfile] = useState<Profile | null>(null);
  const [envs, setEnvs] = useState<Env[]>([]);
  const [tweakCmd, setTweakCmd] = useState('');
  const [tweakErr, setTweakErr] = useState('');
  const [roastText, setRoastText] = useState('');
  const [roastBusy, setRoastBusy] = useState(false);

  // Parse source and advance to review
  const handleProceedToReview = async () => {
    setBusy(true);
    setErr('');
    try {
      const p = await readSource(text, file);
      setProfile(p);
      const allocated = assign(p);
      setEnvs(allocated);
      setStep('review');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Adjust envelope allocations in Review
  const handleTweak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tweakCmd.trim()) return;
    setTweakErr('');
    try {
      let nextEnvs = envs;
      const moves = await adjust(tweakCmd, nextEnvs);
      for (const m of moves) {
        const from = nextEnvs.find((x) => x.name.toLowerCase() === m.from.toLowerCase());
        const to = nextEnvs.find((x) => x.name.toLowerCase() === m.to.toLowerCase());
        if (!from || !to) throw new Error(`Could not find "${!from ? m.from : m.to}".`);
        const amt = Math.min(m.amount, from.assigned);
        nextEnvs = nextEnvs.map((x) => {
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
      setEnvs(nextEnvs);
      setTweakCmd('');
    } catch (err) {
      setTweakErr((err as Error).message);
    }
  };

  const handleRoast = async () => {
    if (!profile) return;
    setRoastBusy(true);
    const r = await roast(profile);
    setRoastText(r);
    setRoastBusy(false);
  };

  // Complete onboarding
  const handleFinish = () => {
    if (!profile) return;
    onDone({
      profile,
      envelopes: envs,
      log: [],
      transactions: [],
      approved: true,
      roast: roastText || undefined,
    });
  };

  return (
    <div className="onboarding-container">
      {/* Step Progress Tracker */}
      <div className="step-tracker">
        <div className={`step-node ${step === 'input' ? 'active' : 'done'}`}>
          <span className="step-num">1</span>
          <span className="step-txt">Your Money</span>
        </div>
        <div className="step-connector" />
        <div className={`step-node ${step === 'review' ? 'active' : step === 'primer' ? 'done' : ''}`}>
          <span className="step-num">2</span>
          <span className="step-txt">AI Envelopes</span>
        </div>
        <div className="step-connector" />
        <div className={`step-node ${step === 'primer' ? 'active' : ''}`}>
          <span className="step-num">3</span>
          <span className="step-txt">Budget Rules</span>
        </div>
      </div>

      <PublikCard />

      {/* STEP 1: INPUT */}
      {step === 'input' && (
        <div className="home-content">
          <p className="kicker">Stop paying YNAB $109/year to budget your own money.</p>

          <div
            className={`letter airmail ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (e.dataTransfer.files?.[0]) {
                setFile(e.dataTransfer.files[0]);
                setActiveTab('file');
              }
            }}
          >
            <div className="stamp"><b>FREE</b><i>no signup</i></div>
            <div className="postmark" aria-hidden>LOCAL<br />ONLY<br />•••</div>
            <h1>Drop anything.<br />Get funded envelopes.</h1>

            {/* Input Method Switcher */}
            <div className="input-tabs">
              <button
                type="button"
                className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
                onClick={() => setActiveTab('text')}
              >
                ✏️ Tell me in plain English
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
                onClick={() => setActiveTab('file')}
              >
                📎 Drop bank statement / CSV
              </button>
            </div>

            {activeTab === 'text' ? (
              <div className="text-mode">
                <label className="addr">
                  <span>Type a quick brain dump of what you have and what's due:</span>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    placeholder="I have $1,900 in checking, rent is $1,400 on the 1st, and I get paid $2,200 on Friday"
                  />
                </label>

                {/* Quick Presets */}
                <div className="presets-block">
                  <span className="presets-title">Or click a sample scenario:</span>
                  <div className="preset-chips">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="preset-chip"
                        onClick={() => setText(p.text)}
                      >
                        <b>{p.label}</b>
                        <small>{p.desc}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="file-mode">
                <div
                  className="file-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {file ? (
                    <div className="file-picked">
                      <span className="file-icon">📄</span>
                      <b>{file.name}</b>
                      <small>({(file.size / 1024).toFixed(1)} KB)</small>
                      <button
                        type="button"
                        className="remove-file"
                        onClick={(ev) => { ev.stopPropagation(); setFile(undefined); }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="dropzone-prompt">
                      <span className="drop-icon">📥</span>
                      <b>Drop your bank statement (CSV, PDF, Screenshot) or YNAB export here</b>
                      <small>or click to browse files on your device</small>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.pdf,image/*"
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0])}
                />
              </div>
            )}

            <div className="onboarding-actions">
              <button
                className="go lg"
                disabled={busy || (!text.trim() && !file)}
                onClick={handleProceedToReview}
              >
                {busy ? 'Reading & Analyzing…' : 'Generate Funded Envelopes →'}
              </button>
            </div>

            {err && <p className="err" role="alert">{err}</p>}
          </div>

          <p className="fine">
            Your data stays in your browser. {aiConfigured ? 'Publik AI connected.' : 'Local heuristic parsing mode.'}
          </p>
        </div>
      )}

      {/* STEP 2: REVIEW & FUNDING */}
      {step === 'review' && profile && (
        <div className="review-step narrow">
          <div className="review-header">
            <h2>Step 2: Here's where every dollar goes</h2>
            <p className="review-sub">
              Zero-based budgeting rule #1: <b>Give every dollar a job.</b> We allocated your current cash so you know what survives until your next paycheck.
            </p>
          </div>

          {/* Cash on hand card */}
          <div className="cash-card">
            <div className="cash-info">
              <span>CURRENT CASH ON HAND</span>
              <b>{fmt(profile.cash)}</b>
            </div>
            <div className="cash-detail">
              {profile.income ? (
                <span>Next expected inflow: <b>{fmt(profile.income.amount)}</b> ({profile.income.when})</span>
              ) : (
                <span>Every single dollar is assigned to an envelope below.</span>
              )}
            </div>
          </div>

          {/* Initial envelopes breakdown */}
          <div className="envelopes-summary">
            <h3>Your Initial Envelopes ({envs.length})</h3>
            <ul className="ledger airmail">
              {envs.map((e) => (
                <li key={e.id}>
                  <div>
                    <span className="env-name">{e.name}</span>
                    <small className="env-pri">{PRIORITY_LABEL[e.priority]}</small>
                  </div>
                  <div className="env-funds">
                    {e.target > e.assigned && (
                      <span className="env-target-note">Target: {fmt(e.target)}</span>
                    )}
                    <b>{fmt(e.assigned)}</b>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Subscriptions caught */}
          {profile.subs.length > 0 && (
            <div className="subs-card">
              <h4>🔍 Subscriptions Caught ({profile.subs.length})</h4>
              {profile.subs.map((s) => (
                <div key={s.name} className="sub-row">
                  <span>{s.name}</span>
                  <span>{fmt(s.monthly)}/mo</span>
                </div>
              ))}
              <div className="sub-tot">
                <span>Annual Subscription Cost</span>
                <b>{fmt(Math.round(profile.subs.reduce((acc, x) => acc + x.monthly, 0) * 12))}/yr</b>
              </div>
            </div>
          )}

          {/* Statement Roast */}
          {roastText ? (
            <blockquote className="roast-box">
              <b>🔥 AI Statement Roast:</b> {roastText}
            </blockquote>
          ) : (
            <div className="roast-cta">
              <button className="ghost sm" disabled={roastBusy} onClick={handleRoast}>
                {roastBusy ? 'Analyzing spending…' : '🔥 Roast My Statement'}
              </button>
            </div>
          )}

          {/* Move command bar */}
          <form className="tweak-bar" onSubmit={handleTweak}>
            <span className="tweak-label">Move:</span>
            <input
              value={tweakCmd}
              onChange={(e) => setTweakCmd(e.target.value)}
              placeholder='Tell me what to move: "move $100 from Savings to Groceries"'
            />
            <button disabled={!tweakCmd.trim()} className="go sm">Apply</button>
          </form>
          {tweakErr && <p className="err sm">{tweakErr}</p>}

          <div className="review-footer-row">
            <button className="ghost" onClick={() => setStep('input')}>← Back to Input</button>
            <button className="go" onClick={() => setStep('primer')}>Looks Good: Continue →</button>
          </div>
        </div>
      )}

      {/* STEP 3: 10-SECOND BUDGET PRIMER */}
      {step === 'primer' && (
        <div className="primer-step narrow">
          <div className="primer-card">
            <h2>You're ready. Here is the 10-second rulebook:</h2>
            <div className="rules-grid">
              <div className="rule-item">
                <div className="rule-badge">1</div>
                <div>
                  <h4>Give Every Dollar a Job</h4>
                  <p>When you get paid, money enters <b>Ready to Assign</b>. Use <i>Auto-Assign</i> to fill your bills and essentials first, then savings.</p>
                </div>
              </div>

              <div className="rule-item">
                <div className="rule-badge">2</div>
                <div>
                  <h4>Roll With the Punches</h4>
                  <p>Overspent on groceries or dinner? No stress. Click <b>Cover</b> or type <i>"move $30 from Fun to Dining"</i> to keep envelopes honest.</p>
                </div>
              </div>

              <div className="rule-item">
                <div className="rule-badge">3</div>
                <div>
                  <h4>Check Reality Before Swiping</h4>
                  <p>Tempted by a $700 PS5 or weekend trip? Tap <b>Can I Afford It?</b> to see how many Chipotle runs and days of Age of Money it really costs.</p>
                </div>
              </div>
            </div>

            <div className="primer-cta">
              <button className="go lg" onClick={handleFinish}>
                Open My Budget →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

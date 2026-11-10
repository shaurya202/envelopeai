import { useEffect, useState } from 'react';
import { fetchPublikStatus, provisionPublik, type PublikStatus } from './ai';

export function PublikCard({ topUpNotice }: { topUpNotice?: { message: string; url: string | null } | null }) {
  const [status, setStatus] = useState<PublikStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchPublikStatus().then(setStatus);
  }, []);

  if (topUpNotice) {
    return (
      <div className="publik-card notice-402" role="alert">
        <p>{topUpNotice.message}</p>
        {topUpNotice.url && (
          <a className="publik-btn primary" href={topUpNotice.url} target="_blank" rel="noopener noreferrer">
            Top up publik balance →
          </a>
        )}
      </div>
    );
  }

  if (!status) return null;

  if (status.provider === 'needs_consent') {
    return (
      <div className="publik-card">
        <p className="publik-disclosure">{status.disclosure}</p>
        <button
          className="go"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            await provisionPublik();
            const next = await fetchPublikStatus();
            setStatus(next);
            setLoading(false);
          }}
        >
          {loading ? 'Connecting…' : 'Enable Publik AI (Free $0.05)'}
        </button>
      </div>
    );
  }

  if (status.provider === 'publik' && status.balanceLine) {
    const isAnonymous = status.claimState === 'anonymous' || !status.claimState;
    const btnUrl = isAnonymous ? status.claimUrl : status.addCreditUrl;
    const btnText = isAnonymous ? 'Sign in with publik' : 'Add a plan or pack';

    return (
      <div className="publik-card">
        <div className="publik-balance">{status.balanceLine}</div>
        {status.costSentence && <div className="publik-cost">{status.costSentence}</div>}
        {btnUrl && (
          <a className="publik-btn" href={btnUrl} target="_blank" rel="noopener noreferrer">
            {btnText} →
          </a>
        )}
      </div>
    );
  }

  return null;
}

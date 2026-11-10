import type { Budget } from './types';
import { downloadReceipt, receiptLines } from './receiptText';

export function Receipt({ b }: { b: Budget }) {
  const lines = receiptLines(b);
  return (
    <div className="narrow center">
      <pre className="receipt">{lines.join('\n')}</pre>
      <div className="row end">
        <button className="ghost" onClick={() => navigator.clipboard.writeText(lines.join('\n'))}>Copy text</button>
        <button className="go" onClick={() => downloadReceipt(lines)}>Download PNG</button>
      </div>
    </div>
  );
}

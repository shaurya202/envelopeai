import { createServer } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_SLUG,
  APP_VERSION,
  DEFAULT_BASE_URL,
  MODELS,
  DISCLOSURE,
  resolveProvider,
  provision,
  selfTest,
  balanceLine,
  topUpUrlFrom402,
  readCredential,
} from './publik.js';

// Startup check for publik build verification
if (process.env.PUBLIK_SELF_TEST) {
  const line = await selfTest();
  console.log(line);
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5173;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS for dev
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API: Status
  if (url.pathname === '/api/publik/status' && req.method === 'GET') {
    const prov = resolveProvider();
    const cred = prov.kind === 'publik' ? prov.credential : readCredential();
    return sendJson(res, 200, {
      provider: prov.kind,
      disclosure: DISCLOSURE,
      balanceLine: cred ? balanceLine(cred.balance_micros, cred.claim_state) : null,
      claimUrl: cred?.claim_url ?? null,
      claimState: cred?.claim_state ?? null,
      addCreditUrl: cred?.add_credit_url ?? null,
      costSentence: cred?.cost_sentence ?? null,
    });
  }

  // API: Provision
  if (url.pathname === '/api/publik/provision' && req.method === 'POST') {
    try {
      const cred = await provision();
      return sendJson(res, 200, {
        ok: true,
        balanceLine: balanceLine(cred.balance_micros, cred.claim_state),
        claimUrl: cred.claim_url,
        costSentence: cred.cost_sentence,
      });
    } catch (e) {
      return sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // API: AI task relay
  if (url.pathname === '/api/ai' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.task) return sendJson(res, 400, { error: 'Missing task' });

    const prov = resolveProvider(body.userKey ? { apiKey: body.userKey, baseURL: DEFAULT_BASE_URL } : null);
    if (prov.kind === 'needs_consent') {
      return sendJson(res, 403, { error: 'needs_consent', disclosure: DISCLOSURE });
    }

    const { task, input } = body;
    let messages = [];

    if (task === 'roast') {
      messages = [
        { role: 'system', content: 'You are a direct, witty financial coach. Give a 2-3 sentence roast of this spending profile. Mention specific merchants, subscription totals, or eating out.' },
        { role: 'user', content: JSON.stringify(input) },
      ];
    } else if (task === 'afford_line') {
      messages = [
        { role: 'system', content: 'You are an honest budget coach. In 1 concise punchy sentence, tell the user what buying this item really costs them in terms of their budget tradeoffs.' },
        { role: 'user', content: `Item: ${input.label}, Price: $${input.price}. Tradeoffs: ${input.lines.join('; ')}` },
      ];
    } else if (task === 'adjust') {
      messages = [
        { role: 'system', content: 'You parse natural language envelope budget adjustments. Return JSON ONLY: {"moves":[{"from":"envelope name","to":"envelope name","amount":number}]}. Do not include markdown or backticks.' },
        { role: 'user', content: `Instruction: "${input.instruction}". Available envelopes: ${JSON.stringify(input.envelopes)}` },
      ];
    } else {
      messages = [
        { role: 'system', content: 'You are a financial parsing assistant. Return valid JSON only.' },
        { role: 'user', content: JSON.stringify({ task, input }) },
      ];
    }

    try {
      const chatRes = await fetch(`${prov.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${prov.apiKey}`,
        },
        body: JSON.stringify({
          model: MODELS.fast,
          messages,
        }),
      });

      const chatBody = await chatRes.json().catch(() => ({}));
      if (chatRes.status === 402) {
        return sendJson(res, 402, topUpUrlFrom402(chatBody));
      }
      if (!chatRes.ok) {
        return sendJson(res, chatRes.status, { error: chatBody.error?.message || `API error ${chatRes.status}` });
      }

      const text = chatBody.choices?.[0]?.message?.content?.trim() || '';
      if (task === 'adjust') {
        try {
          const cleaned = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          return sendJson(res, 200, parsed);
        } catch {
          return sendJson(res, 200, { moves: [] });
        }
      }
      return sendJson(res, 200, { text });
    } catch (e) {
      return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Static files from dist/
  let filePath = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST, 'index.html');
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. Run "npm run build" first.');
  }
});

function startServer() {
  server.listen(PORT, () => {
    console.log(`EnvelopeAI running on http://localhost:${PORT}`);
  });
}

if (!process.env.PUBLIK_SELF_TEST) {
  startServer();
}

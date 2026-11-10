# EnvelopeAI

Local-first, AI-assisted envelope budgeting. See FEATURES.md.

    npm install && npm run dev      # app
    npm test                        # logic self-check
    npm run build

## Wiring the Publik API
Copy `.env.example` to `.env`, set `VITE_PUBLIK_API_URL` (and optionally `VITE_PUBLIK_API_KEY`). `src/ai.ts` POSTs `{task, input}` and expects JSON:

| task | input | returns |
|---|---|---|
| `profile_from_text` | `{text}` | `Profile` (src/types.ts) |
| `profile_from_file` | `{name, mime, data (data URL), note}` | `Profile` |
| `roast` | `Profile` | `{text}` |
| `afford_line` | `{label, price, lines}` | `{text}` |
| `adjust` | `{instruction, envelopes}` | `{moves: [{from, to, amount}]}` |

Unset, everything falls back to local heuristics (CSV/YNAB parsing, templated copy); PDFs and screenshots need the API.

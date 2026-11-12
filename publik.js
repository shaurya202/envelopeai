// publik.js — publik API as one provider option. Resolution order:
// the user's own key > PUBLIK_API_KEY / PUBLIK_API_BASE_URL env > this app's
// credential file > provision on first launch (after the user accepts
// DISCLOSURE) > the user's own key again if provisioning fails.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_SLUG = "envelopeai";
export const APP_VERSION = "1.0.0";
const ORIGIN = process.env.PUBLIK_ORIGIN || "https://publikhq.com";
export const DEFAULT_BASE_URL = `${ORIGIN}/api/v1`;
/** Ask for a tier, never a vendor model name. */
export const MODELS = { fast: "publik-fast", balanced: "publik-balanced", smart: "publik-smart" };
/** Show this and get a yes BEFORE provision(). */
export const DISCLOSURE =
  "This app can use publik API for its AI features: no key to paste, priced per use in dollars from a publik balance that starts at $0.00. " +
  "Linking this computer to a publik account gives $0.05 of free use, once. Your prompts go through publik's servers to the model; you can switch to your own key at any time.";

export function appToken() {
  const env = process.env.PUBLIK_APP_TOKEN?.trim();
  if (env) return env;
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const file = join(dir, "publik-app-token.txt");
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    if (dirname(dir) === dir) return "";
  }
}

function publikDir() {
  const os = platform();
  const base =
    os === "darwin" ? join(homedir(), "Library", "Application Support")
    : os === "win32" ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
    : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "publik");
}

/** ~/Library/Application Support/publik/apps/<slug>.json, %LOCALAPPDATA%\publik\apps\<slug>.json, ~/.config/publik/apps/<slug>.json */
export function credentialPath() {
  return join(publikDir(), "apps", `${APP_SLUG}.json`);
}

export function readCredential() {
  try {
    const c = JSON.parse(readFileSync(credentialPath(), "utf8"));
    return typeof c.key === "string" && c.key.startsWith("pk_") ? c : null;
  } catch {
    return null;
  }
}

export function writeCredential(c) {
  const file = credentialPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch {}
}

export function resolveProvider(userKey = null) {
  if (userKey?.apiKey) return { kind: "own", ...userKey };
  if (process.env.PUBLIK_API_KEY) {
    return { kind: "publik", baseURL: process.env.PUBLIK_API_BASE_URL ?? DEFAULT_BASE_URL, apiKey: process.env.PUBLIK_API_KEY, credential: null };
  }
  const c = readCredential();
  if (c) return { kind: "publik", baseURL: c.base_url || DEFAULT_BASE_URL, apiKey: c.key, credential: c };
  return { kind: "needs_consent" };
}

/** Call only after the user accepted DISCLOSURE. Throws a readable message; the caller offers the user's own key. */
export async function provision() {
  const token = appToken();
  if (!token.startsWith("pat_")) throw new Error("This build has no publik API app token. Use your own key for now.");
  const prior = readCredential();
  let installId = prior?.install_id ?? randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${ORIGIN}/api/v1/installs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_token: token, app_slug: APP_SLUG, app_version: APP_VERSION,
        os: platform() === "darwin" ? "macos" : platform() === "win32" ? "windows" : "linux",
        arch: arch(), device_name: hostname().slice(0, 120), install_id: installId,
        disclosure_version: 1, dialects: ["chat_completions"],
      }),
    });
    const body = await res.json().catch(() => ({}));
    const key = body.key ?? (res.status === 200 ? prior?.key ?? null : null);
    if ((res.status === 201 || res.status === 200) && key) {
      const c = {
        key, base_url: body.base_url ?? DEFAULT_BASE_URL, install_id: body.install_id ?? installId,
        claim_url: body.claim_url ?? null, claim_state: body.claim_state ?? "anonymous",
        add_credit_url: body.wallet?.add_credit_url ?? null, cost_sentence: body.disclosure?.cost ?? null,
        balance_micros: body.balance_micros ?? null,
      };
      writeCredential(c);
      return c;
    }
    if (res.status === 200 || body.error?.type === "install_revoked") { installId = randomUUID(); continue; }
    throw new Error(body.error?.message ?? `publik API could not set up this computer (${res.status}). Use your own key for now.`);
  }
  throw new Error("publik API could not set up this computer. Use your own key for now.");
}

export async function readWallet(key = null) {
  const k = key || readCredential()?.key;
  if (!k) return { status: 401, wallet: null, message: "No key" };
  const res = await fetch(`${DEFAULT_BASE_URL}/wallet`, {
    headers: { authorization: `Bearer ${k}` },
    signal: AbortSignal.timeout(15000),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || typeof b.claim_state !== "string") return { status: res.status, wallet: null, message: b.error?.message ?? null };
  return {
    status: res.status,
    message: null,
    wallet: { ...b, account: b.account ?? null, plan: b.plan ?? { kind: "none", label: null }, balance_micros: b.balance_micros ?? 0 },
  };
}

/** Builder check, run by the BUILT app: start it with PUBLIK_SELF_TEST=1, print this line, exit.
 *  It provisions for real; the builder who runs it is the consent. */
export async function selfTest() {
  try {
    const inst = await provision();
    const r = await readWallet(inst.key);
    if (!r.wallet) throw new Error(r.message ?? `GET /wallet answered ${r.status}`);
    return `publik self-test: ok ${APP_SLUG} ${APP_VERSION} (install ${inst.install_id.slice(0, 8)})`;
  } catch (e) {
    const offline = e instanceof TypeError || (e instanceof Error && /abort|timeout/i.test(e.name));
    return `publik self-test: failed: ${offline ? "publik is not reachable. Check your connection." : e instanceof Error ? e.message : String(e)}`;
  }
}

// ---------- usage counting: /skills/telemetry.md sections 3-5 ----------
let timer = null;
let installIdOnce = null;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usageOff() {
  const dnt = (process.env.DO_NOT_TRACK ?? "").trim().toLowerCase();
  if (dnt !== "" && dnt !== "0" && dnt !== "false") return true;
  if (["0", "false", "off"].includes((process.env.PUBLIK_TELEMETRY ?? "").trim().toLowerCase())) return true;
  try {
    return JSON.parse(readFileSync(join(publikDir(), "consent.json"), "utf8")).usage === false;
  } catch {
    return false;
  }
}

/** One random UUID per computer account, shared by every publik app, in <publik dir>/telemetry.json (mode 0600). */
function telemetryInstallId() {
  const file = join(publikDir(), "telemetry.json");
  const saved = () => {
    try {
      const id = String(JSON.parse(readFileSync(file, "utf8")).install_id).toLowerCase();
      return UUID_REGEX.test(id) ? id : null;
    } catch {
      return null;
    }
  };
  if ((installIdOnce ??= saved())) return installIdOnce;
  const fresh = randomUUID();
  try {
    mkdirSync(publikDir(), { recursive: true, mode: 0o700 });
    writeFileSync(
      file,
      JSON.stringify({ install_id: fresh, created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z") }) + "\n",
      { flag: "wx", mode: 0o600 }
    );
    return (installIdOnce = fresh);
  } catch {
    return (installIdOnce = saved() ?? fresh);
  }
}

async function sendEvent(event) {
  const say = (result) => {
    if (process.env.PUBLIK_TELEMETRY_DEBUG === "1") {
      process.stderr.write(`publik-telemetry: ${event} -> ${result}\n`);
    }
  };
  try {
    const osMap = { darwin: "macos", win32: "windows", linux: "linux" };
    const currentOS = osMap[platform()];
    if (!currentOS) return;
    if (usageOff()) return say("off (opt-out)");
    const cred = readCredential();
    const key = process.env.PUBLIK_API_KEY || cred?.key;
    const body = {
      v: 1,
      app: APP_SLUG,
      install_id: telemetryInstallId(),
      event,
      app_version: APP_VERSION.replace(/^v/i, ""),
      os: currentOS,
      ...(arch() === "arm64" || arch() === "x64" ? { arch: arch() } : {}),
    };
    const endpoint = process.env.PUBLIK_TELEMETRY_URL || `${ORIGIN}/api/v1/telemetry`;
    const headers = {
      "content-type": "application/json",
      ...(key?.startsWith("pk_") ? { authorization: `Bearer ${key}` } : {}),
    };
    const res = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers,
      body: JSON.stringify(body),
    });
    say(res.status);
  } catch (e) {
    say(e instanceof Error ? e.name : "error");
  }
}

/** Called at startup: app_opened now, active_session every 30 minutes; never fails the app, never blocks. */
export function startTelemetry() {
  if (timer) return;
  const s = Number(process.env.PUBLIK_TELEMETRY_INTERVAL_SECONDS);
  timer = setInterval(() => void sendEvent("active_session"), (s >= 1 && s <= 86400 ? s : 1800) * 1000);
  timer.unref?.();
  void sendEvent("app_opened");
}

export function stopTelemetry() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function balanceLine(micros, claimState = "anonymous") {
  if (micros == null) return "";
  const dollars = `$${(micros / 1_000_000).toFixed(2)}`;
  return micros === 0 && claimState === "anonymous" ? `${dollars} · link this computer for $0.05 of free use` : `${dollars} of publik balance`;
}

export function topUpUrlFrom402(body) {
  const e = body?.error;
  return { message: e?.message ?? "Not enough publik API balance.", url: e?.top_up_url ?? null };
}

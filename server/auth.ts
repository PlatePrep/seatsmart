import crypto from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { rawDb } from "./storage";

/**
 * Single shared staff password for the host app.
 * - Stored as a salted scrypt hash in app_meta (never in plain text).
 * - First run: uses APP_PASSWORD from the environment, or generates one and prints it once.
 * - Sessions are HMAC-signed tokens; changing the password invalidates every session.
 * - Guest pages (/api/portal) and provider webhooks stay public by design.
 */
rawDb.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
const get = (k: string) => (rawDb.prepare("SELECT value FROM app_meta WHERE key = ?").get(k) as { value: string } | undefined)?.value;
const set = (k: string, v: string) => rawDb.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

const SESSION_DAYS = 14;
const PUBLIC = [/^\/api\/auth\/(login|status)$/, /^\/api\/portal\//, /^\/api\/webhooks\//];

function hash(pw: string, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}
function verify(pw: string, stored: string) {
  const [salt, h] = stored.split(":");
  const a = Buffer.from(h, "hex");
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setPassword(pw: string) {
  set("password_hash", hash(pw));
  set("session_secret", crypto.randomBytes(32).toString("hex")); // logs everyone out
}

export function initAuth() {
  const env = process.env.APP_PASSWORD;
  if (env && (!get("password_hash") || process.env.APP_PASSWORD_RESET === "1")) {
    setPassword(env);
  } else if (!get("password_hash")) {
    const pw = crypto.randomBytes(9).toString("base64url");
    setPassword(pw);
    console.log(`\n[auth] No APP_PASSWORD set. Generated staff password: ${pw}\n[auth] Change it in Settings → Password.\n`);
  }
}

function sign(exp: number) {
  const mac = crypto.createHmac("sha256", get("session_secret")!).update(String(exp)).digest("base64url");
  return `${exp}.${mac}`;
}
function valid(token: string | undefined) {
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = sign(Number(exp)).split(".")[1];
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}
// __Host- prefix: required on pplx.app hosting, and it pins the cookie to this exact host
const COOKIE = "__Host-ss_session";
function tokenFrom(req: Request) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  const parts = req.headers.cookie?.split(";").map((s) => s.trim()) || [];
  const c = parts.find((s) => s.startsWith(COOKIE + "=")) || parts.find((s) => s.startsWith("ss_session="));
  return c ? decodeURIComponent(c.slice(c.indexOf("=") + 1)) : undefined;
}

// simple per-IP throttle on login attempts
const attempts = new Map<string, { n: number; until: number }>();

export function registerAuth(app: Express) {
  initAuth();

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/") || PUBLIC.some((r) => r.test(req.path))) return next();
    if (valid(tokenFrom(req))) return next();
    res.status(401).json({ message: "Sign in required" });
  });

  app.get("/api/auth/status", (req, res) => res.json({ authenticated: valid(tokenFrom(req)) }));

  app.post("/api/auth/login", (req, res) => {
    const ip = req.ip || "x";
    const a = attempts.get(ip);
    if (a && a.until > Date.now()) return res.status(429).json({ message: "Too many tries. Wait a minute and try again." });
    if (!verify(String(req.body?.password || ""), get("password_hash")!)) {
      const n = (a?.n || 0) + 1;
      attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      return res.status(401).json({ message: "Wrong password" });
    }
    attempts.delete(ip);
    const token = sign(Date.now() + SESSION_DAYS * 86400_000);
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${SESSION_DAYS * 86400}`);
    res.json({ token });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`);
    res.json({ ok: true });
  });

  app.post("/api/auth/password", (req, res) => {
    const cur = String(req.body?.current || "");
    const next = String(req.body?.next || "");
    if (!verify(cur, get("password_hash")!)) return res.status(400).json({ message: "Current password is wrong" });
    if (next.length < 8) return res.status(400).json({ message: "Use at least 8 characters" });
    setPassword(next);
    const token = sign(Date.now() + SESSION_DAYS * 86400_000);
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${SESSION_DAYS * 86400}`);
    res.json({ token });
  });
}

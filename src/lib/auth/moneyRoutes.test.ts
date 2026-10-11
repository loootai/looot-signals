import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as exportCsv } from "@/app/api/export/route";
import { POST as run } from "@/app/api/run/route";
import { POST as webhook } from "@/app/api/webhook/route";
import { resetLimits } from "./limits";
import { csrfToken, verifySession } from "./session";

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.9" };
const KEYS = ["SIGNALS_ADMIN_PASSWORD", "SIGNALS_STATE", "SIGNALS_WEBHOOK_URL", "SIGNALS_CAP_USD", "NEXT_PUBLIC_DEMO", "LOOOT_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /signals_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
const authed = (url: string, s: { cookie: string; token: string }, body: unknown = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, cookie: s.cookie, "x-signals-csrf": s.token }, body: JSON.stringify(body) });

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  process.env.SIGNALS_STATE = join(mkdtempSync(join(process.cwd(), ".vitest", "money-")), "state.json");
  process.env.SIGNALS_ADMIN_PASSWORD = PW;
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.LOOOT_TOKEN;
  delete process.env.SIGNALS_WEBHOOK_URL;
  resetLimits();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe("spending route", () => {
  it("needs the CSRF token, not only the session", async () => {
    const s = await session();
    const res = await run(new Request("http://localhost:3000/api/run", { method: "POST", headers: { ...H, cookie: s.cookie }, body: JSON.stringify({ confirmedMaxMicros: 1000 }) }));
    expect(res.status).toBe(403);
  });
  it("allows 10 runs in 10 minutes per session, then answers 429", async () => {
    const s = await session();
    for (let i = 0; i < 10; i++) expect((await run(authed("/api/run", s, {}))).status).toBe(400);
    const res = await run(authed("/api/run", s, {}));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const other = await session();
    expect((await run(authed("/api/run", other, {}))).status).toBe(400);
  });
  it("a caller cannot raise the cap: the run cap is the server cap even if the body asks for more", async () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    process.env.SIGNALS_CAP_USD = "0.01";
    vi.resetModules();
    const { runNow } = await import("@/lib/service");
    const res = await runNow(1_000_000_000_000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.run.capMicros).toBe(10_000);
      expect(res.run.spentMicros).toBeLessThanOrEqual(10_000);
    }
  });
  it("a run is refused when the live price is above the amount the caller confirmed", async () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    vi.resetModules();
    const { runNow } = await import("@/lib/service");
    const res = await runNow(1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("blocked_price");
  });
});

describe("webhook route", () => {
  it("refuses a target on a private address before any request is made", async () => {
    const s = await session();
    for (const url of ["https://10.0.0.5/hook", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", `https://user:pw${"@"}hooks.example/x`, "ftp://hooks.example/x", "http://localhost:9000/x"]) {
      process.env.SIGNALS_WEBHOOK_URL = url;
      const res = await webhook(authed("/api/webhook", s));
      expect(res.status, url).toBe(400);
    }
  });
  it("is rate limited per session", async () => {
    const s = await session();
    process.env.SIGNALS_WEBHOOK_URL = "https://10.0.0.5/hook";
    for (let i = 0; i < 10; i++) expect((await webhook(authed("/api/webhook", s))).status).toBe(400);
    expect((await webhook(authed("/api/webhook", s))).status).toBe(429);
  });
});

describe("export route", () => {
  it("is never cached", async () => {
    const s = await session();
    const res = await exportCsv(new Request("http://localhost:3000/api/export", { headers: { ...H, cookie: s.cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

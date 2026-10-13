import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { PUT as putTriggers } from "@/app/api/triggers/route";
import { proxy } from "@/proxy";
import { resetLimits } from "./limits";

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
const KEYS = ["SIGNALS_ADMIN_PASSWORD", "SIGNALS_STATE", "SIGNALS_TRIGGERS", "NEXT_PUBLIC_DEMO", "LOOOT_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /signals_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";
const triggersText = readFileSync(join(process.cwd(), "triggers.example.yaml"), "utf8");

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "flow-"));
  process.env.SIGNALS_STATE = join(dir, "state.json");
  process.env.SIGNALS_TRIGGERS = join(dir, "triggers.yaml");
  process.env.SIGNALS_ADMIN_PASSWORD = PW;
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.LOOOT_TOKEN;
  resetLimits();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("sign in", () => {
  it("a wrong password gets 401 and no cookie", async () => {
    const res = await login(post("/api/auth/login", { password: "nope-nope-nope-nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("the right password sets a hardened cookie that opens admin routes", async () => {
    const res = await login(post("/api/auth/login", { password: PW }));
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Max-Age=/);
    const page = await proxy(new NextRequest("http://localhost:3000/runs", { headers: { cookie: cookieOf(res) } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
  it("a form post redirects to the page asked for, and never off site", async () => {
    const form = (next: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { host: H.host, origin: H.origin, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": H["x-forwarded-for"] }, body: new URLSearchParams({ password: PW, next }) });
    expect((await login(form("/runs"))).headers.get("location")).toBe("/runs");
    expect((await login(form("//evil.example"))).headers.get("location")).toBe("/");
    expect((await login(form("https://evil.example"))).headers.get("location")).toBe("/");
  });
  it("locks the address after 5 wrong passwords, and the right password does not help until the window ends", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", { password: `wrong-password-${i}-xx` }))).status).toBe(401);
    const locked = await login(post("/api/auth/login", { password: PW }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
  });
  it("refuses a sign-in posted from another site", async () => {
    const res = await login(post("/api/auth/login", { password: PW }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
  it("sign in does nothing in the demo and answers 503 when no password is set", async () => {
    delete process.env.SIGNALS_ADMIN_PASSWORD;
    expect((await login(post("/api/auth/login", { password: PW }))).status).toBe(503);
    process.env.NEXT_PUBLIC_DEMO = "1";
    expect((await login(post("/api/auth/login", { password: PW }))).status).toBe(400);
  });
  it("accepts the browser's 'Origin: null' form post when Sec-Fetch-Site says same-origin, and refuses it otherwise", async () => {
    const ok = await login(post("/api/auth/login", { password: PW }, { origin: "null", "sec-fetch-site": "same-origin" }));
    expect(ok.status).toBe(200);
    expect((await login(post("/api/auth/login", { password: PW }, { origin: "null", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await login(post("/api/auth/login", { password: PW }, { origin: "null" }))).status).toBe(403);
  });
  it("sign out clears the cookie, and only for a same-site request", async () => {
    const ok = await logout(post("/api/auth/logout", {}));
    expect(ok.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("CSRF on state-changing admin requests", () => {
  async function session() {
    const res = await login(post("/api/auth/login", { password: PW }));
    const cookie = cookieOf(res);
    const { csrfToken, verifySession } = await import("./session");
    const s = (await verifySession(process.env, cookie.split("=")[1]))!;
    return { cookie, token: await csrfToken(process.env, s.sid) };
  }
  const put = (headers: Record<string, string>) => putTriggers(new Request("http://localhost:3000/api/triggers", { method: "PUT", headers: { ...H, ...headers }, body: JSON.stringify({ text: triggersText }) }));
  it("rejects a cross-site origin even with a valid session", async () => {
    const { cookie, token } = await session();
    expect((await put({ cookie, "x-signals-csrf": token, origin: "https://evil.example" })).status).toBe(403);
  });
  it("rejects a same-origin request without the token, or with someone else's", async () => {
    const { cookie } = await session();
    expect((await put({ cookie })).status).toBe(403);
    expect((await put({ cookie, "x-signals-csrf": "AAAA" })).status).toBe(403);
  });
  it("accepts a same-origin request with the session token", async () => {
    const { cookie, token } = await session();
    expect((await put({ cookie, "x-signals-csrf": token })).status).toBe(200);
  });
  it("a request with no Origin and no fetch metadata is refused", async () => {
    const { cookie, token } = await session();
    const res = await putTriggers(new Request("http://localhost:3000/api/triggers", { method: "PUT", headers: { host: H.host, cookie, "x-signals-csrf": token }, body: JSON.stringify({ text: triggersText }) }));
    expect(res.status).toBe(403);
  });
});

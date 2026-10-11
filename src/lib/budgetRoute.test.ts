import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as run } from "@/app/api/run/route";
import { resetLimits } from "@/lib/auth/limits";
import { csrfToken, verifySession } from "@/lib/auth/session";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "SIGNALS_STATE", "SIGNALS_TRIGGERS", "SIGNALS_BUDGET", "SIGNALS_ADMIN_PASSWORD", "SIGNALS_CAP_USD", "SIGNALS_DAILY_USD", "SIGNALS_MONTHLY_USD", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url?.startsWith("/v1/public-catalog/")) return void res.end(JSON.stringify({ price: { state: "known", amountMicros: 10_000, unit: "result" } }));
    if (req.method === "POST") paidRuns++;
    res.statusCode = req.method === "POST" ? 200 : 404;
    res.end(JSON.stringify({ runId: `r${paidRuns}`, status: "completed", result: {}, actualCost: 0.05 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-route-"));
  // One funding trigger: one call quoted at 20 rows x $0.01 = $0.20.
  writeFileSync(join(dir, "triggers.yaml"), "triggers:\n  - id: rounds\n    name: Rounds\n    type: funding\n    stages: [seed]\n    limit: 20\n");
  process.env.SIGNALS_STATE = join(dir, "state.json");
  process.env.SIGNALS_TRIGGERS = join(dir, "triggers.yaml");
  process.env.SIGNALS_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  process.env.SIGNALS_CAP_USD = "1";
  delete process.env.SIGNALS_BUDGET;
  delete process.env.SIGNALS_DAILY_USD;
  delete process.env.SIGNALS_MONTHLY_USD;
  delete process.env.NEXT_PUBLIC_DEMO;
  paidRuns = 0;
  resetLimits();
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /signals_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
type S = Awaited<ReturnType<typeof session>>;
const call = (fn: (r: Request) => Promise<Response>, method: string, path: string, body: unknown, s: S) => fn(new Request(`http://localhost:3000${path}`, { method, headers: { ...H, cookie: s.cookie, "x-signals-csrf": s.token }, body: body === undefined ? undefined : JSON.stringify(body) }));
const status = async (s: S) => (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as { limits: { dailyMicros: number; monthlyMicros: number }; day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number } };

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const s = await session();
    const j = await status(s);
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
    expect(j.day.usedMicros).toBe(0);
  });

  it("refuses to change the budget without the session", async () => {
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: H, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(401);
  });

  it("refuses to change the budget without the CSRF token", async () => {
    const s = await session();
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: { ...H, cookie: s.cookie }, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(403);
  });

  it("lets the signed-in owner change the budget", async () => {
    const s = await session();
    expect((await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 1, monthlyUsd: 3 }, s)).status).toBe(200);
    expect((await status(s)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
  });

  it("ignores a budget sent in a run request", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.002 }, s);
    const res = await call(run, "POST", "/api/run", { confirmedMaxMicros: 1_000_000, dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 }, limits: { dailyMicros: 1e15 } }, s);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
    expect((await status(s)).limits.dailyMicros).toBe(1_000);
  });

  it("ignores a cap sent in a run request: the cap is the server's", async () => {
    process.env.SIGNALS_CAP_USD = "0.3";
    const s = await session();
    const res = await call(run, "POST", "/api/run", { confirmedMaxMicros: 250_000, capUsd: 1000, capMicros: 1e12, cap: 1000, maxSpendUsd: 1000 }, s);
    const j = (await res.json()) as { run: { capMicros: number; spentMicros: number } };
    expect(res.status).toBe(200);
    expect(j.run.capMicros).toBe(300_000);
  });

  it("still holds the server cap when the body asks for a very large amount", async () => {
    process.env.SIGNALS_CAP_USD = "0.1";
    const s = await session();
    const res = await call(run, "POST", "/api/run", { confirmedMaxMicros: 1e12, capUsd: 1e9 }, s);
    const j = (await res.json()) as { run: { capMicros: number; calls: { status: string }[] } };
    expect(j.run.capMicros).toBe(100_000);
    expect(j.run.calls[0].status).toBe("skipped_cap");
    expect(paidRuns).toBe(0);
  });

  it("does not charge a repeated identical run twice", async () => {
    const s = await session();
    expect((await call(run, "POST", "/api/run", { confirmedMaxMicros: 300_000 }, s)).status).toBe(200);
    expect(paidRuns).toBe(1);
    expect((await call(run, "POST", "/api/run", { confirmedMaxMicros: 300_000 }, s)).status).toBe(200);
    expect(paidRuns).toBe(1);
    expect((await status(s)).day.usedMicros).toBe(50_000);
  });

  it("charges identical requests started together once", async () => {
    const s = await session();
    const out = await Promise.all([1, 2, 3, 4].map(() => call(run, "POST", "/api/run", { confirmedMaxMicros: 300_000 }, s)));
    expect(out.every((r) => r.status === 200)).toBe(true);
    expect((await status(s)).day.usedMicros).toBe(50_000);
    expect((await status(s)).day.reservedMicros).toBe(0);
  });
});

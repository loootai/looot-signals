import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const run = (args: string[], env: Record<string, string> = {}) => spawnSync("node_modules/.bin/tsx", ["src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, LOOOT_TOKEN: "", ...env } });

describe("cli", () => {
  it("--dry-run prints the cost and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-cli-"));
    const r = run(["--dry-run", "--state", join(dir, "s.json"), "--out", join(dir, "out")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Total at most $0.5310 for 7 calls");
    expect(r.stdout).toContain("no looot call was made");
    expect(existsSync(join(dir, "s.json"))).toBe(false);
    expect(existsSync(join(dir, "out"))).toBe(false);
  });
  it("--demo writes json, csv and md, and a second run finds nothing new", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-cli-"));
    const args = ["--demo", "--state", join(dir, "s.json"), "--out", join(dir, "out")];
    const first = run(args);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/19 new signals/);
    const files = readdirSync(join(dir, "out"));
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
    const json = JSON.parse(readFileSync(join(dir, "out", files.find((f) => f.endsWith(".json"))!), "utf8"));
    expect(json[0]).toHaveProperty("evidenceUrl");
    expect(run(args).stdout).toMatch(/0 new signals/);
  });
  it("stops with a clear message when there is no token", () => {
    const r = run(["--state", join(mkdtempSync(join(tmpdir(), "signals-cli-")), "s.json")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("LOOOT_TOKEN is not set");
  });
  it("rejects a bad trigger file", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-cli-"));
    execFileSync("node", ["-e", `require('fs').writeFileSync('${join(dir, "t.yaml")}', 'triggers: []')`]);
    const r = run(["--dry-run", "--triggers", join(dir, "t.yaml")]);
    expect(r.status).toBe(2);
  });
});

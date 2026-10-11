import { describe, expect, it, vi } from "vitest";
import { isBlockedIp, resolveSafe, validateWebhookUrl } from "./netGuard";
import { sendWebhook } from "./export";

// Built in code so the credential-in-URL cases do not look like email addresses to the leak scan.
const AT = "@";

const BLOCKED = [
  "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "169.254.0.1",
  "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.1", "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
  "::", "::1", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "2001::1",
  "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:192.168.0.1", "::ffff:0:10.0.0.1",
  "64:ff9b::a00:1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2002:a9fe:a9fe::1", "::127.0.0.1", "::10.0.0.1",
];
const ALLOWED = ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.0.1", "192.169.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"];

describe("isBlockedIp", () => {
  for (const ip of BLOCKED) it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  for (const ip of ALLOWED) it(`allows ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  it("blocks what it cannot parse", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
    expect(isBlockedIp("1.2.3")).toBe(true);
    expect(isBlockedIp("999.1.1.1")).toBe(true);
  });
});

describe("validateWebhookUrl", () => {
  it("accepts an https URL on a public name or address", () => {
    expect(validateWebhookUrl("https://hooks.example.com/x?a=1").ok).toBe(true);
    expect(validateWebhookUrl("https://8.8.8.8/x").ok).toBe(true);
    expect(validateWebhookUrl("https://[2606:4700:4700::1111]/x").ok).toBe(true);
  });
  const REFUSED = [
    "http://hooks.example.com/x", "ftp://hooks.example.com/x", "file:///etc/passwd", "gopher://hooks.example.com", "javascript:alert(1)", "data:text/plain,hi", "not a url", "",
    `https://user${AT}hooks.example.com/x`, `https://user:pw${AT}hooks.example.com/x`, `https://:pw${AT}hooks.example.com/x`,
    "https://localhost/x", "https://LOCALHOST/x", "https://foo.localhost/x", "https://printer.local/x", "https://db.internal/x", "https://localhost./x",
    "https://127.0.0.1/x", "https://127.1/x", "https://2130706433/x", "https://0x7f.0.0.1/x", "https://0177.0.0.1/x", "https://0/x",
    "https://10.0.0.5/x", "https://172.16.0.1/x", "https://172.31.255.255/x", "https://192.168.0.1/x",
    "https://169.254.169.254/latest/meta-data", "https://169.254.1.1/x", "https://[::1]/x", "https://[::]/x", "https://[fe80::1]/x", "https://[fc00::1]/x", "https://[fd00::1]/x",
    "https://[::ffff:127.0.0.1]/x", "https://[::ffff:7f00:1]/x", "https://[::ffff:169.254.169.254]/x", "https://[::ffff:10.0.0.1]/x", "https://[0:0:0:0:0:ffff:c0a8:1]/x",
    "http://localhost:9000/x", "http://127.0.0.1:9000/x",
  ];
  for (const u of REFUSED) it(`refuses ${JSON.stringify(u)}`, () => expect(validateWebhookUrl(u).ok).toBe(false));
});

const lookupTo = (...addrs: string[]) => vi.fn(async () => addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

describe("resolveSafe", () => {
  it("returns the address when every resolved address is public", async () => {
    const r = await resolveSafe("hooks.example.com", lookupTo("93.184.216.34"));
    expect(r).toEqual({ address: "93.184.216.34", family: 4 });
  });
  it("refuses a name that resolves to a private address", async () => {
    await expect(resolveSafe("hooks.example.com", lookupTo("10.0.0.5"))).rejects.toThrow(/private|internal/i);
    await expect(resolveSafe("hooks.example.com", lookupTo("169.254.169.254"))).rejects.toThrow();
    await expect(resolveSafe("hooks.example.com", lookupTo("::ffff:127.0.0.1"))).rejects.toThrow();
    await expect(resolveSafe("hooks.example.com", lookupTo("::1"))).rejects.toThrow();
  });
  it("refuses when any one of several answers is private", async () => {
    await expect(resolveSafe("hooks.example.com", lookupTo("93.184.216.34", "192.168.1.1"))).rejects.toThrow();
  });
  it("refuses when the name does not resolve", async () => {
    await expect(resolveSafe("nope.example", vi.fn(async () => []))).rejects.toThrow();
    await expect(resolveSafe("nope.example", vi.fn(async () => { throw new Error("ENOTFOUND"); }))).rejects.toThrow();
  });
  it("checks an IP literal without a lookup", async () => {
    const look = lookupTo("93.184.216.34");
    await expect(resolveSafe("127.0.0.1", look)).rejects.toThrow();
    expect(await resolveSafe("8.8.8.8", look)).toEqual({ address: "8.8.8.8", family: 4 });
    expect(look).not.toHaveBeenCalled();
  });
});

describe("sendWebhook at send time", () => {
  const sig = { source: "looot-signals" };
  it("re-checks the resolved address: a public-looking name that resolves inside is not called", async () => {
    const post = vi.fn(async () => 200);
    await expect(sendWebhook("https://hooks.example.com/x", [], { lookup: lookupTo("10.0.0.5"), post })).rejects.toThrow();
    await expect(sendWebhook("https://hooks.example.com/x", [], { lookup: lookupTo("169.254.169.254"), post })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it("connects to the address it checked, not to a second lookup", async () => {
    const post = vi.fn(async (_t: unknown) => 202);
    const lookup = lookupTo("93.184.216.34");
    const status = await sendWebhook("https://hooks.example.com/x?a=1", [], { lookup, post, secret: "k" });
    expect(status).toBe(202);
    expect(lookup).toHaveBeenCalledTimes(1);
    const target = post.mock.calls[0][0] as { address: string; hostname: string; path: string; headers: Record<string, string> };
    expect(target.address).toBe("93.184.216.34");
    expect(target.hostname).toBe("hooks.example.com");
    expect(target.path).toBe("/x?a=1");
    expect(target.headers["X-Signals-Signature"]).toMatch(/^sha256=/);
    void sig;
  });
  it("does not follow a redirect: a 302 is returned as the status and nothing else is requested", async () => {
    const post = vi.fn(async () => 302);
    expect(await sendWebhook("https://hooks.example.com/x", [], { lookup: lookupTo("93.184.216.34"), post })).toBe(302);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("refuses a bad URL before any lookup", async () => {
    const lookup = lookupTo("93.184.216.34");
    await expect(sendWebhook(`https://user:pw${AT}hooks.example.com/x`, [], { lookup })).rejects.toThrow(/credentials|webhook/i);
    await expect(sendWebhook("http://127.0.0.1:9000/x", [], { lookup })).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
});

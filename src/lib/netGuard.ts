import { promises as dns } from "node:dns";
import { isIP } from "node:net";

/** One answer from a DNS lookup. */
export interface Resolved {
  address: string;
  family: number;
}
export type Lookup = (hostname: string) => Promise<Resolved[]>;

/** Looks a name up with the system resolver and returns every address it has. */
export const systemLookup: Lookup = async (hostname) => (await dns.lookup(hostname, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family }));

/** The four bytes of a dotted IPv4 address, or null when it is not one. */
function parseV4(s: string): number[] | null {
  if (isIP(s) !== 4) return null;
  const parts = s.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** The eight 16-bit groups of an IPv6 address, with a trailing dotted IPv4 folded in, or null. */
function parseV6(s: string): number[] | null {
  if (isIP(s) !== 6 || s.includes("%")) return null;
  let text = s;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function blockedV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network and 0.0.0.0
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a === 127 ||
    (a === 169 && b === 254) || // link-local, including cloud metadata at 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol block, TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

const v4From = (hi: number, lo: number): number[] => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/**
 * true when `ip` is an address a webhook must never reach: private, loopback, link-local (incl. cloud
 * metadata), unspecified, multicast, reserved, unique-local, or an IPv6 form that wraps one of those
 * (IPv4-mapped, SIIT, NAT64, 6to4, deprecated IPv4-compatible). Text that is not an IP counts as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return blockedV4(v4);
  const g = parseV6(ip);
  if (!g) return true;
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and the deprecated ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return blockedV4(v4From(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return blockedV4(v4From(g[6], g[7])); // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return g.slice(2, 6).every((x) => x === 0) ? blockedV4(v4From(g[6], g[7])) : true; // NAT64
  if (g[0] === 0x2002) return blockedV4(v4From(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard prefix
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".intranet", ".lan", ".home.arpa"];

export type UrlCheck = { ok: true; url: URL; hostname: string } | { ok: false; error: string };

/**
 * Checks a webhook URL without any network call. https only, no credentials in the URL, no internal
 * name, no private, loopback, link-local, unspecified or unique-local address (numeric forms such as
 * 2130706433 or 0x7f.1 are normalised by the URL parser first). The hostname is checked again after DNS
 * at send time, see resolveSafe.
 */
export function validateWebhookUrl(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "The webhook URL is not a valid URL." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "The webhook must be an https URL." };
  if (u.username || u.password) return { ok: false, error: "The webhook URL must not contain credentials." };
  let hostname = u.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  hostname = hostname.replace(/\.$/, "");
  if (!hostname) return { ok: false, error: "The webhook URL has no host." };
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) return { ok: false, error: "The webhook must not point at a private, loopback or link-local address." };
  } else if (hostname === "localhost" || INTERNAL_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, error: "The webhook must not point at a local or internal host name." };
  }
  return { ok: true, url: u, hostname };
}

/**
 * Resolves `hostname` and returns the address to connect to. Throws when the name does not resolve or
 * when any answer is a blocked address. The caller connects to the returned address, so a second DNS
 * answer cannot swap in an internal one.
 */
export async function resolveSafe(hostname: string, lookup: Lookup = systemLookup): Promise<Resolved> {
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error("The webhook host is a private or internal address.");
    return { address: hostname, family: isIP(hostname) };
  }
  let answers: Resolved[];
  try {
    answers = await lookup(hostname);
  } catch {
    throw new Error("The webhook host did not resolve.");
  }
  if (answers.length === 0) throw new Error("The webhook host did not resolve.");
  if (answers.some((a) => isBlockedIp(a.address))) throw new Error("The webhook host resolves to a private or internal address.");
  return answers[0];
}

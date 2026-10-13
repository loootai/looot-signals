import type { Founder, RawSignal, SourceId } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** First non-empty string among the given keys of an object. */
function pick(o: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Lower-case host of a URL or bare domain, without "www.". null when the text has no host. */
export function hostOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  try {
    const u = new URL(/^[a-z]+:\/\//.test(t) ? t : `https://${t}`);
    const h = u.hostname.replace(/^www\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

/** A date or timestamp as an ISO string, or null. Understands "3 days ago" and "2 weeks ago" given `now`. */
export function toIso(v: unknown, now: Date): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v !== "string" || v.trim() === "") return null;
  const rel = /^(\d+)\s*(minute|hour|day|week|month)s?\s+ago$/i.exec(v.trim());
  if (rel) {
    const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[rel[2].toLowerCase()] ?? 0;
    return new Date(now.getTime() - Number(rel[1]) * unit).toISOString();
  }
  if (/^yesterday$/i.test(v.trim())) return new Date(now.getTime() - 86_400_000).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The rows of a provider answer: the first array of objects, looking in the usual wrapper keys first. */
export function rowsOf(result: unknown, preferred: string[] = ["data", "results", "items", "jobs", "news", "companies", "organic", "output"]): Obj[] {
  if (Array.isArray(result)) return result.filter(isObj);
  if (!isObj(result)) return [];
  for (const k of preferred) {
    const v = result[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const inner = rowsOf(v, preferred);
      if (inner.length > 0) return inner;
    }
  }
  for (const v of Object.values(result)) if (Array.isArray(v) && v.length > 0 && isObj(v[0])) return v.filter(isObj);
  return [];
}

const COMPANY_VERBS = "raises|raised|secures|secured|lands|landed|closes|closed|announces|announced|appoints|appointed|names|named|hires|hired|promotes|promoted|launches|launched|bags|gets|nabs|picks up|adds|welcomes|taps";
const NEWS_COMPANY = new RegExp(`^(?:exclusive:\\s*)?([A-Z0-9][\\w.&'’-]*(?:\\s+[A-Z0-9][\\w.&'’-]*){0,3})\\s+(?:${COMPANY_VERBS})\\b`);

/** Best-effort company name from a headline such as "Acme raises $12M". null when the title does not fit the pattern. */
export function companyFromHeadline(title: string): string | null {
  const m = NEWS_COMPANY.exec(title.trim());
  return m ? m[1].trim() : null;
}

/** LinkedIn job index and similar job lists. */
export function parseJobsIndex(result: unknown, now: Date): RawSignal[] {
  return rowsOf(result).flatMap((r) => {
    const title = pick(r, ["title", "jobTitle", "job_title", "position", "name"]);
    if (!title) return [];
    const companyObj = isObj(r.company) ? r.company : null;
    const company = pick(r, ["companyName", "company_name", "organization"]) ?? (companyObj ? pick(companyObj, ["name", "companyName"]) : pick(r, ["company"]));
    const domain = hostOf(pick(r, ["companyDomain", "company_domain", "domain", "companyWebsite", "website"]) ?? (companyObj ? pick(companyObj, ["domain", "website"]) : null));
    const location = pick(r, ["location", "short_location", "jobLocation"]);
    return [
      {
        company,
        domain,
        headline: `Hiring: ${title}`,
        detail: [company, location].filter(Boolean).join(", ") || undefined,
        evidenceUrl: pick(r, ["url", "jobUrl", "job_url", "link", "applyUrl", "final_url"]),
        occurredAt: toIso(r.postedAt ?? r.posted_at ?? r.createdUtc ?? r.datePosted ?? r.date_posted ?? r.listedAt ?? r.postedDate ?? r.posted, now),
      },
    ];
  });
}

/** TheirStack style job rows, which carry the company domain and the description. */
export function parseJobsText(result: unknown, now: Date, keywords: string[] = []): RawSignal[] {
  return rowsOf(result).flatMap((r) => {
    const title = pick(r, ["job_title", "title"]);
    if (!title) return [];
    const obj = isObj(r.company_object) ? r.company_object : null;
    const description = pick(r, ["description", "job_description"]) ?? "";
    const hits = keywords.filter((k) => new RegExp(`(^|[^\\w])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`, "i").test(description));
    return [
      {
        company: pick(r, ["company", "company_name"]) ?? (obj ? pick(obj, ["name"]) : null),
        domain: hostOf(pick(r, ["company_domain"]) ?? (obj ? pick(obj, ["domain"]) : null)),
        headline: `Hiring: ${title}`,
        detail: hits.length > 0 ? `Ad mentions ${hits.join(", ")}` : pick(r, ["short_location", "location"]) ?? undefined,
        evidenceUrl: pick(r, ["final_url", "url", "source_url"]),
        occurredAt: toIso(r.date_posted ?? r.discovered_at, now),
      },
    ];
  });
}

/** PredictLeads style financing events (JSON:API with an `included` list of companies). */
export function parseFunding(result: unknown, now: Date): RawSignal[] {
  const included = isObj(result) && Array.isArray(result.included) ? result.included.filter(isObj) : [];
  const companies = new Map<string, Obj>();
  for (const c of included) if (typeof c.id === "string" && isObj(c.attributes)) companies.set(c.id, c.attributes);
  return rowsOf(result).flatMap((r) => {
    const a = isObj(r.attributes) ? r.attributes : r;
    const relObj = isObj(r.relationships) ? (r.relationships.company ?? r.relationships.companies) : undefined;
    const relData = isObj(relObj) ? relObj.data : undefined;
    const rel = Array.isArray(relData) ? relData.find(isObj) : isObj(relData) ? relData : undefined;
    const co = (rel && typeof rel.id === "string" ? companies.get(rel.id) : undefined) ?? (isObj(a.company) ? a.company : {});
    const type = pick(a, ["financing_type_normalized", "financing_type", "category"]);
    const amount = pick(a, ["amount_normalized", "amount"]);
    const summary = pick(a, ["summary", "title", "headline"]);
    const company = pick(co, ["company_name", "name"]) ?? pick(a, ["company_name"]);
    if (!summary && !type) return [];
    return [
      {
        company,
        domain: hostOf(pick(co, ["domain", "website"]) ?? pick(a, ["domain"])),
        headline: `Funding: ${[type?.replace(/_/g, " "), amount ? `$${Number(amount).toLocaleString("en-US")}` : null].filter(Boolean).join(", ") || "round announced"}`,
        detail: summary ?? undefined,
        evidenceUrl: pick(a, ["url", "source_url", "article_url"]),
        occurredAt: toIso(a.effective_date ?? a.published_at ?? a.updated_at ?? a.created_at, now),
      },
    ];
  });
}

/** Serper style Google News rows. The company is a guess from the headline. */
export function parseNews(result: unknown, now: Date): RawSignal[] {
  return rowsOf(result, ["news", "results", "data", "items", "organic"]).flatMap((r) => {
    const title = pick(r, ["title"]);
    const link = pick(r, ["link", "url"]);
    if (!title || !link) return [];
    return [{ company: companyFromHeadline(title), domain: null, headline: title, detail: [pick(r, ["source"]), pick(r, ["snippet"])].filter(Boolean).join(": ") || undefined, evidenceUrl: link, occurredAt: toIso(r.date ?? r.published_at ?? r.publishedAt, now) }];
  });
}

/** Signalbase style job-change rows. Names arrive masked (first name and last initial). */
export function parseJobChanges(result: unknown, now: Date): RawSignal[] {
  return rowsOf(result).flatMap((r) => {
    const role = pick(r, ["new_role", "newRole", "new_position", "position", "title"]);
    if (!role) return [];
    const person = pick(r, ["person_name", "personName", "name", "full_name"]);
    const company = pick(r, ["company_name", "companyName", "new_company", "company"]);
    return [
      {
        company,
        domain: hostOf(pick(r, ["company_domain", "companyDomain", "domain"])),
        headline: `New role: ${role}`,
        detail: [person, company].filter(Boolean).join(" at ") || undefined,
        evidenceUrl: pick(r, ["person_linkedin_url", "personLinkedinUrl", "linkedin_url", "linkedinUrl", "url"]),
        occurredAt: toIso(r.signal_date ?? r.date ?? r.detected_at ?? r.created_at, now),
      },
    ];
  });
}

/**
 * Founders of one company (Aviato style). The catalog documents no response fields, so this reads several
 * usual names for each value and returns nothing for an answer it does not understand. Shape not verified.
 */
export function parseFounders(result: unknown): Founder[] {
  const seen = new Set<string>();
  return rowsOf(result, ["items", "founders", "data", "results"]).flatMap((r) => {
    const name = pick(r, ["fullName", "full_name", "name"]) ?? ([pick(r, ["firstName", "first_name"]), pick(r, ["lastName", "last_name"])].filter(Boolean).join(" ") || null);
    if (!name || seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    return [{ name, title: pick(r, ["headline", "title", "role", "position", "jobTitle"]), linkedinUrl: pick(r, ["linkedinURL", "linkedinUrl", "linkedin_url", "linkedin"]) }];
  });
}

function nameOfInvestor(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (!isObj(v)) return null;
  const direct = pick(v, ["name", "fullName", "full_name", "investorName", "investor_name"]);
  if (direct) return direct;
  for (const k of ["investor", "company", "person", "organization"]) {
    const inner = v[k];
    if (isObj(inner)) {
      const n = pick(inner, ["name", "fullName", "full_name"]);
      if (n) return n;
    }
  }
  return null;
}

function investorsOfRound(round: Obj): string[] {
  const names: string[] = [];
  for (const k of ["investors", "investorList", "investor_list", "leadInvestors", "lead_investors"]) {
    const list = round[k];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const n = nameOfInvestor(item);
      if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
  }
  return names;
}

/**
 * Investors in a company's latest round, from a funding-rounds answer (Aviato style: `fundingRounds` with
 * `announcedOn` and an investor list). Uses the round with the newest date; if it names nobody, the newest
 * round that does. The catalog documents no response fields, so this is tolerant and the shape is not verified.
 */
export function parseInvestors(result: unknown): string[] {
  const rounds = rowsOf(result, ["fundingRounds", "funding_rounds", "rounds", "items", "data", "results"]);
  const dated = rounds.map((r, i) => ({ r, i, at: pick(r, ["announcedOn", "announced_on", "date", "effective_date", "closedOn"]) ?? "" }));
  dated.sort((a, b) => b.at.localeCompare(a.at) || a.i - b.i);
  for (const { r } of dated) {
    const names = investorsOfRound(r);
    if (names.length > 0) return names;
  }
  return [];
}

/** Parses an endpoint answer into signals. `keywords` lets the job-text parser say which keyword matched. */
export function parseSource(source: SourceId, result: unknown, now: Date, keywords: string[] = []): RawSignal[] {
  switch (source) {
    case "jobs_index":
      return parseJobsIndex(result, now);
    case "jobs_text":
      return parseJobsText(result, now, keywords);
    case "funding":
      return parseFunding(result, now);
    case "news":
      return parseNews(result, now);
    case "job_changes":
      return parseJobChanges(result, now);
  }
}

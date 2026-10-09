import type { SourceId, Trigger, TriggerType } from "./types";

export const PRICES_AS_OF = "2026-10-10";

export interface SourceDef {
  id: SourceId;
  label: string;
  /** looot job id, kept as the catalog reference. */
  jobId: string;
  /** The pinned looot endpoint this app runs. No fallback routing, so the price is the one quoted. */
  endpointId: string;
  /** "call" is billed once per call. "result" is billed per returned row, so the quote assumes `limit` rows. */
  unit: "call" | "result";
  /** Micro-dollars, read from the public catalog on PRICES_AS_OF. */
  fallbackMicros: number;
  /** false until someone has checked a real response body against the parser. */
  shapeVerified: boolean;
}

/** Every source the app can run. Job ids, endpoints and prices come from the free looot catalog. */
export const SOURCES: Record<SourceId, SourceDef> = {
  jobs_index: { id: "jobs_index", label: "LinkedIn job index", jobId: "jobs.search", endpointId: "anyapi-run-linkedin-jobs-thin", unit: "call", fallbackMicros: 500, shapeVerified: false },
  jobs_text: { id: "jobs_text", label: "Job ads with description match", jobId: "jobs.search", endpointId: "theirstack-jobs-search", unit: "result", fallbackMicros: 32_700, shapeVerified: false },
  funding: { id: "funding", label: "Financing events", jobId: "company.funding", endpointId: "predictleads-discover-financing-events", unit: "result", fallbackMicros: 10_000, shapeVerified: false },
  news: { id: "news", label: "Google News", jobId: "news.search", endpointId: "serper-news", unit: "call", fallbackMicros: 1000, shapeVerified: false },
  job_changes: { id: "job_changes", label: "Job change feed", jobId: "people.job.changes", endpointId: "signalbase-signals-job-changes", unit: "call", fallbackMicros: 108_000, shapeVerified: false },
};

/** Sources a trigger type may use. The first one is the default. */
export const SOURCES_FOR_TYPE: Record<TriggerType, SourceId[]> = {
  hiring: ["jobs_index", "jobs_text"],
  funding: ["funding", "news"],
  news: ["news"],
  leadership: ["news", "job_changes"],
};

/** The source a trigger runs: its own choice, or the cheapest one that can answer it. */
export function sourceFor(t: Trigger): SourceId {
  if (t.source) return t.source;
  if (t.type === "hiring") return t.keywords.length > 0 ? "jobs_text" : "jobs_index";
  return SOURCES_FOR_TYPE[t.type][0];
}

function dateFrom(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function newsWindow(days: number): string {
  if (days <= 1) return "qdr:d";
  if (days <= 7) return "qdr:w";
  if (days <= 31) return "qdr:m";
  return "qdr:y";
}

function postedWindow(days: number): string {
  if (days <= 1) return "past 24 hours";
  if (days <= 7) return "past week";
  return "past month";
}

export interface CallInput {
  /** What this call looks for, for the quote screen: the title, role or query. */
  label: string;
  input: Record<string, unknown>;
}

/** The inputs of every call a trigger makes in one run. The count of calls is the count of items returned. */
export function callsFor(t: Trigger, now: Date): CallInput[] {
  const source = sourceFor(t);
  const country = t.countries[0];
  if (source === "jobs_index") {
    return t.titles.map((title) => ({ label: title, input: { query: title, limit: Math.min(t.limit, 25), postedLimit: postedWindow(t.maxAgeDays), ...(country ? { location: country } : {}) } }));
  }
  if (source === "jobs_text") {
    return [
      {
        label: [...t.titles, ...t.keywords].join(", "),
        input: {
          ...(t.titles.length > 0 ? { job_title_or: t.titles } : {}),
          ...(t.keywords.length > 0 ? { job_description_contains_or: t.keywords } : {}),
          posted_at_max_age_days: t.maxAgeDays,
          ...(t.countries.length > 0 ? { job_country_code_or: t.countries } : {}),
          limit: Math.min(t.limit, 25),
          offset: 0,
        },
      },
    ];
  }
  if (source === "funding") {
    return [{ label: t.stages.join(", ") || "any round", input: { ...(t.stages.length > 0 ? { financing_types_normalized: t.stages.join(",") } : {}), ...(country ? { company_location: country } : {}), limit: Math.min(t.limit, 100) } }];
  }
  if (source === "job_changes") {
    return t.roles.map((role) => ({ label: role, input: { new_role: role, dateFrom: dateFrom(now, t.maxAgeDays), limit: Math.min(t.limit, 100), sort_by: "date", sort_order: "desc", ...(country ? { countries: country } : {}) } }));
  }
  // news. Leadership and funding triggers on this source search for the announcement wording.
  const queries =
    t.type === "leadership"
      ? t.roles.map((role) => `("appoints" OR "names" OR "hires" OR "promotes") "${role}"`)
      : t.type === "funding"
        ? [t.query ?? `("raises" OR "secures" OR "closes") ("seed" OR "Series A" OR "Series B" OR "funding round")`]
        : [t.query ?? ""];
  return queries.map((q) => ({ label: q, input: { q, num: Math.min(t.limit, 100), tbs: newsWindow(t.maxAgeDays), ...(country ? { gl: country.toLowerCase() } : {}) } }));
}

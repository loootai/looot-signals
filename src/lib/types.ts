export type TriggerType = "hiring" | "funding" | "news" | "leadership";
export type SourceId = "jobs_index" | "jobs_text" | "funding" | "news" | "job_changes";
/** A paid lookup made for each new company a funding trigger finds. */
export type FollowUpId = "founders" | "investors";

/** One trigger the user defined. Edited as YAML, validated in triggers.ts. */
export interface Trigger {
  id: string;
  name: string;
  type: TriggerType;
  /** Overrides the default source for the type. */
  source?: SourceId;
  enabled: boolean;
  /** hiring: job titles to look for. One call per title on the index source. */
  titles: string[];
  /** hiring: words that must appear in the job ad. Needs the text source. */
  keywords: string[];
  /** leadership: roles such as "head of sales". One call per role. */
  roles: string[];
  /** news: the search query. */
  query?: string;
  /** funding: normalized financing types, such as "series_a". */
  stages: string[];
  countries: string[];
  /** Signals older than this many days are dropped. */
  maxAgeDays: number;
  /** Most results one call may return. Result-priced sources are quoted at this number. */
  limit: number;
  /** funding: lookups to run for each new company, one paid call per company and kind. */
  enrich: FollowUpId[];
  /** funding: most new companies to look up per run, per kind. The quote is price times this number. */
  enrichLimit: number;
}

/** A founder of a company, as the provider names them. */
export interface Founder {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
}

/** What a source parser returns before dedupe. */
export interface RawSignal {
  company: string | null;
  domain: string | null;
  /** One line that says what happened. */
  headline: string;
  detail?: string;
  /** The page that proves it. */
  evidenceUrl: string | null;
  /** When it happened, ISO date. null when the provider gave none. */
  occurredAt: string | null;
}

export interface Signal extends RawSignal {
  /** Set by the founders lookup. [] means the provider was asked and named nobody. undefined means not asked. */
  founders?: Founder[];
  /** Set by the investors lookup: investors in the company's latest round. [] means asked, none named. */
  investors?: string[];
  /** Stable key: the same signal found again gets the same id. */
  id: string;
  triggerId: string;
  triggerName: string;
  /** Other triggers that found the same evidence in later runs. */
  alsoTriggers: string[];
  type: TriggerType;
  source: SourceId;
  endpointId: string;
  /** When this app first saw it, ISO timestamp. */
  firstSeenAt: string;
  runId: string;
}

export type CallStatus = "completed" | "failed" | "pending" | "skipped_cap" | "skipped_budget" | "skipped_price" | "dry_run";

export interface CallRecord {
  triggerId: string;
  source: SourceId;
  /** Set when this call is a per-company lookup rather than the trigger's own search. */
  followUp?: FollowUpId;
  /** The company domain a lookup was made for. */
  domain?: string;
  endpointId: string;
  idempotencyKey: string;
  status: CallStatus;
  runId: string | null;
  costMicros: number;
  quotedMicros: number;
  found: number;
  fresh: number;
  error?: string;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt: string;
  newSignals: number;
  spentMicros: number;
  capMicros: number;
  calls: CallRecord[];
}

export interface PendingCall {
  triggerId: string;
  source: SourceId;
  endpointId: string;
  runId: string;
  quotedMicros: number;
}

/** Everything the app remembers between runs. One JSON file. */
export interface SignalState {
  version: 1;
  signals: Signal[];
  pending: Record<string, PendingCall>;
  runs: RunRecord[];
}

export const EMPTY_STATE: SignalState = { version: 1, signals: [], pending: {}, runs: [] };

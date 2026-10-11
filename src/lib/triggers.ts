import { parse } from "yaml";
import { z } from "zod";
import { SOURCES_FOR_TYPE, sourceFor } from "./sources";
import type { Trigger } from "./types";

export class TriggerFileError extends Error {}

const list = z.array(z.string().trim().min(1)).default([]);

const TriggerSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "id: lowercase letters, digits and dashes"),
  name: z.string().trim().min(1).max(80),
  type: z.enum(["hiring", "funding", "news", "leadership"]),
  source: z.enum(["jobs_index", "jobs_text", "funding", "news", "job_changes"]).optional(),
  enabled: z.boolean().default(true),
  titles: list,
  keywords: list,
  roles: list,
  query: z.string().trim().min(1).optional(),
  stages: list,
  countries: list,
  maxAgeDays: z.number().int().min(1).max(365).default(14),
  limit: z.number().int().min(1).max(100).default(25),
  enrich: z.array(z.enum(["founders", "investors"])).default([]),
  enrichLimit: z.number().int().min(1).max(10).default(3),
});

const FileSchema = z.object({ triggers: z.array(TriggerSchema).min(1).max(50) });

/** Parses and checks a trigger file (YAML or JSON). Throws TriggerFileError with a readable message. */
export function parseTriggers(text: string): Trigger[] {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new TriggerFileError(`The trigger file is not valid YAML: ${(e as Error).message}`);
  }
  const res = FileSchema.safeParse(raw);
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new TriggerFileError(`triggers.${issue.path.join(".")}: ${issue.message}`);
  }
  const ids = new Set<string>();
  for (const t of res.data.triggers) {
    if (ids.has(t.id)) throw new TriggerFileError(`Trigger id "${t.id}" appears twice.`);
    ids.add(t.id);
    if (t.source && !SOURCES_FOR_TYPE[t.type].includes(t.source)) throw new TriggerFileError(`${t.id}: source "${t.source}" cannot answer a ${t.type} trigger. Use one of ${SOURCES_FOR_TYPE[t.type].join(", ")}.`);
    if (t.type === "hiring" && t.titles.length === 0 && t.keywords.length === 0) throw new TriggerFileError(`${t.id}: a hiring trigger needs titles or keywords.`);
    if (t.type === "hiring" && t.keywords.length > 0 && t.source === "jobs_index") throw new TriggerFileError(`${t.id}: keywords match the job description, which the index source does not return. Use jobs_text.`);
    if (t.enrich.length > 0 && t.type !== "funding") throw new TriggerFileError(`${t.id}: enrich only works on funding triggers.`);
    if (t.enrich.length > 0 && sourceFor({ ...t } as Trigger) !== "funding") throw new TriggerFileError(`${t.id}: enrich needs the company domain, which only the funding source returns. Remove source: news.`);
    if (t.type === "leadership" && t.roles.length === 0) throw new TriggerFileError(`${t.id}: a leadership trigger needs roles.`);
    if (t.type === "news" && !t.query) throw new TriggerFileError(`${t.id}: a news trigger needs a query.`);
  }
  return res.data.triggers.map((t) => ({ ...t, enrich: [...new Set(t.enrich)] })) as Trigger[];
}

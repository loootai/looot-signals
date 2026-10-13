import { describe, expect, it } from "vitest";
import { fixtureBody } from "@/demo/fixtures";
import { companyFromHeadline, hostOf, parseFunding, parseJobChanges, parseJobsIndex, parseJobsText, parseNews, rowsOf, toIso } from "./parse";

const NOW = new Date("2026-10-10T09:00:00.000Z");

describe("helpers", () => {
  it("reads the host of a url or bare domain", () => {
    expect(hostOf("https://www.Acme.io/careers")).toBe("acme.io");
    expect(hostOf("acme.io")).toBe("acme.io");
    expect(hostOf("nodots")).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
  it("turns relative and absolute dates into ISO", () => {
    expect(toIso("3 days ago", NOW)).toBe("2026-10-07T09:00:00.000Z");
    expect(toIso("2 weeks ago", NOW)).toBe("2026-09-26T09:00:00.000Z");
    expect(toIso("2026-10-01", NOW)).toBe("2026-10-01T00:00:00.000Z");
    expect(toIso("soon", NOW)).toBeNull();
  });
  it("finds the rows in a wrapper", () => {
    expect(rowsOf({ data: [{ a: 1 }] })).toHaveLength(1);
    expect(rowsOf({ meta: {}, whatever: [{ a: 1 }, { a: 2 }] })).toHaveLength(2);
    expect(rowsOf("nope")).toEqual([]);
  });
  it("guesses a company from a headline", () => {
    expect(companyFromHeadline("Kestrel Data raises $18M Series A")).toBe("Kestrel Data");
    expect(companyFromHeadline("Northwind Labs names Dana Reyes head of sales")).toBe("Northwind Labs");
    expect(companyFromHeadline("Why founders are leaving")).toBeNull();
  });
});

describe("source parsers on the demo fixtures", () => {
  it("job index", () => {
    const s = parseJobsIndex(fixtureBody("anyapi-run-linkedin-jobs-thin", { query: "GTM engineer", limit: 25 }, NOW), NOW);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]).toMatchObject({ company: "Northwind Labs", domain: "northwind.example", headline: "Hiring: GTM Engineer" });
    expect(s[0].evidenceUrl).toContain("linkedin.com/jobs/view");
    expect(s[0].occurredAt).toBe("2026-10-09T09:00:00.000Z");
  });
  it("job text names the keyword that matched", () => {
    const s = parseJobsText(fixtureBody("theirstack-jobs-search", { limit: 10 }, NOW), NOW, ["Clay", "n8n"]);
    expect(s[0].detail).toBe("Ad mentions Clay, n8n");
    expect(s[3].detail).toBe("Ad mentions n8n");
    expect(s[0].domain).toBe("lumenfreight.example");
  });
  it("funding joins the company from the included list", () => {
    const s = parseFunding(fixtureBody("predictleads-discover-financing-events", { limit: 20 }, NOW), NOW);
    expect(s[1]).toMatchObject({ company: "Kestrel Data", domain: "kestrel.example", headline: "Funding: series a, $18,000,000" });
    expect(s[1].evidenceUrl).toBe("https://news.example/funding/1");
  });
  it("news keeps the link and guesses the company", () => {
    const s = parseNews(fixtureBody("serper-news", { q: "head of sales", num: 10 }, NOW), NOW);
    expect(s[0]).toMatchObject({ company: "Northwind Labs", headline: "Northwind Labs names Dana Reyes head of sales" });
    expect(s[0].occurredAt).toBe("2026-10-09T09:00:00.000Z");
  });
  it("job changes", () => {
    const s = parseJobChanges(fixtureBody("signalbase-signals-job-changes", { new_role: "head of sales" }, NOW), NOW);
    expect(s[0]).toMatchObject({ headline: "New role: head of sales", domain: "tidepool.example", detail: "Sam K. at Tidepool" });
  });
  it("returns nothing for an answer it does not understand", () => {
    expect(parseJobsIndex({ error: "x" }, NOW)).toEqual([]);
    expect(parseNews(null, NOW)).toEqual([]);
  });
});

describe("shapes seen in a live run on 2026-10-13", () => {
  it("reads LinkedIn job rows under output.data.items and createdUtc", () => {
    const body = { items: 1, output: { data: { items: [{ id: "1", url: "https://www.linkedin.com/jobs/view/x-1", title: "Revenue Operations Manager", company: "Orbital", location: "New York", createdUtc: 1791504000 }] } } };
    const s = parseJobsIndex(body, NOW);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ company: "Orbital", headline: "Hiring: Revenue Operations Manager", occurredAt: "2026-10-09T00:00:00.000Z" });
  });
  it("finds the company of a financing event through relationships.company", () => {
    const body = {
      data: [{ id: "e1", type: "financing_event", attributes: { financing_type_normalized: "series_a", amount_normalized: 12000000, effective_date: "2026-10-11" }, relationships: { company: { data: { id: "c1", type: "company" } } } }],
      included: [{ id: "c1", type: "company", attributes: { domain: "autobia.example", company_name: "Autobia" } }],
    };
    expect(parseFunding(body, NOW)[0]).toMatchObject({ company: "Autobia", domain: "autobia.example" });
  });
});

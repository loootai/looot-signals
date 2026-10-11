// Sample provider answers for demo mode and tests. Every company is made up and uses the reserved .example domain.
// The shapes follow the providers' public docs; no real response was captured.
const day = (now: Date, ago: number) => new Date(now.getTime() - ago * 86_400_000).toISOString();

const JOB_INDEX = [
  ["GTM Engineer", "Northwind Labs", "northwind.example", "Austin, TX", 1],
  ["Growth Engineer", "Brightpath", "brightpath.example", "Remote, US", 2],
  ["GTM Engineer, Outbound", "Kestrel Data", "kestrel.example", "London, UK", 3],
  ["Senior GTM Engineer", "Tidepool", "tidepool.example", "Berlin, Germany", 5],
  ["Growth Engineer", "Oakline Software", "oakline.example", "New York, NY", 6],
] as const;

const JOB_TEXT = [
  ["Revenue Operations Manager", "Lumen Freight", "lumenfreight.example", "Chicago, IL", 1, "You will build workflows in Clay and n8n to route inbound leads."],
  ["Growth Marketing Lead", "Harbor Health", "harborhealth.example", "Remote", 2, "Own outbound. Our stack is HubSpot, Clay and Apollo."],
  ["RevOps Analyst", "Fieldnote", "fieldnote.example", "Toronto, Canada", 4, "Automate lead enrichment with n8n and Clay."],
  ["Growth Operations Manager", "Pinecrest Cloud", "pinecrest.example", "Denver, CO", 7, "Experience with n8n required."],
] as const;

const FUNDING = [
  ["Brightpath", "brightpath.example", "seed", 4_200_000, 3, "Brightpath closed a $4.2M seed round led by Stonebridge Ventures."],
  ["Kestrel Data", "kestrel.example", "series_a", 18_000_000, 6, "Kestrel Data raised an $18M Series A."],
  ["Tidepool", "tidepool.example", "seed", 2_500_000, 12, "Tidepool announced a $2.5M seed round."],
  ["Lumen Freight", "lumenfreight.example", "series_a", 22_000_000, 19, "Lumen Freight secured a $22M Series A to expand routing software."],
  ["Oakline Software", "oakline.example", "series_b", 41_000_000, 27, "Oakline Software raised $41M in a Series B."],
] as const;

const NEWS = [
  ["Northwind Labs names Dana Reyes head of sales", "northwind-labs", 1, "Trade Daily"],
  ["Kestrel Data appoints new VP sales as it expands in Europe", "kestrel-data", 3, "Startup Wire"],
  ["Fieldnote hires former Atlas exec as head of sales", "fieldnote", 5, "Channel Notes"],
  ["Pinecrest Cloud promotes Omar Haddad to VP sales", "pinecrest-cloud", 9, "The Ledger"],
  ["Harbor Health launches an AI SDR pilot", "harbor-health", 2, "Health Tech Brief"],
] as const;

// Founders and rounds for the funding companies above. The shapes follow the Aviato endpoint descriptions in the looot catalog
// ("fundingRounds with announcedOn and the investor list"). The catalog lists no response fields, so these are guesses.
const FOUNDERS: Record<string, [string, string, string][]> = {
  "brightpath.example": [["Maya Okafor", "Co-founder and CEO", "maya-okafor-example"], ["Luis Brandt", "Co-founder and CTO", "luis-brandt-example"]],
  "kestrel.example": [["Priya Raman", "Founder and CEO", "priya-raman-example"]],
  "tidepool.example": [["Jonas Weber", "Co-founder and CEO", "jonas-weber-example"], ["Ines Duarte", "Co-founder", "ines-duarte-example"]],
  "lumenfreight.example": [["Tom Alvarez", "Founder and CEO", "tom-alvarez-example"]],
  "oakline.example": [["Hana Kim", "Co-founder and CEO", "hana-kim-example"]],
};
const ROUNDS: Record<string, [number, string, string[]][]> = {
  "brightpath.example": [[3, "Seed", ["Stonebridge Ventures", "Alder Capital"]]],
  "kestrel.example": [[400, "Seed", ["Fern Hill Partners"]], [6, "Series A", ["Northlight Capital", "Fern Hill Partners", "Dana Whitcombe"]]],
  "tidepool.example": [[12, "Seed", ["Pier 9 Ventures"]]],
  "lumenfreight.example": [[19, "Series A", ["Granite Road Capital"]]],
  "oakline.example": [[27, "Series B", ["Meridian Growth", "Granite Road Capital"]]],
};

/** A provider-shaped answer for one endpoint. `input` is what the call sent, so limits are honoured. */
export function fixtureBody(endpointId: string, input: Record<string, unknown>, now: Date): unknown {
  const limit = typeof input.limit === "number" ? input.limit : typeof input.num === "number" ? input.num : 25;
  if (endpointId === "anyapi-run-linkedin-jobs-thin") {
    const q = String(input.query ?? "").toLowerCase();
    const rows = JOB_INDEX.filter(([title]) => q.split(/\s+/).some((w) => w.length > 2 && title.toLowerCase().includes(w))).slice(0, limit);
    return { data: rows.map(([title, company, domain, location, ago], i) => ({ title, companyName: company, companyDomain: domain, location, postedAt: day(now, ago), url: `https://www.linkedin.com/jobs/view/${4100000 + i}?trackingId=abc` })) };
  }
  if (endpointId === "theirstack-jobs-search") {
    return { metadata: { total_results: JOB_TEXT.length }, data: JOB_TEXT.slice(0, limit).map(([title, company, domain, location, ago, description], i) => ({ id: 880 + i, job_title: title, company, company_domain: domain, short_location: location, date_posted: day(now, ago).slice(0, 10), description, final_url: `https://careers.${domain}/jobs/${880 + i}` })) };
  }
  if (endpointId === "predictleads-discover-financing-events") {
    return {
      data: FUNDING.slice(0, limit).map(([, , type, amount, ago, summary], i) => ({ id: `fe-${i}`, type: "financing_event", attributes: { financing_type_normalized: type, amount_normalized: amount, summary, effective_date: day(now, ago).slice(0, 10), url: `https://news.example/funding/${i}` }, relationships: { companies: { data: [{ id: `c-${i}`, type: "company" }] } } })),
      included: FUNDING.map(([name, domain], i) => ({ id: `c-${i}`, type: "company", attributes: { company_name: name, domain } })),
    };
  }
  if (endpointId === "serper-news") {
    const q = String(input.q ?? "").toLowerCase();
    const wantsSales = /sales/.test(q);
    const rows = NEWS.filter(([title]) => (wantsSales ? /sales/i.test(title) : !/sales/i.test(title))).slice(0, limit);
    return { news: rows.map(([title, slug, ago, source], i) => ({ title, link: `https://news.example/${slug}-${i}`, snippet: "Sample snippet.", date: ago === 1 ? "1 day ago" : `${ago} days ago`, source, position: i + 1 })) };
  }
  if (endpointId === "signalbase-signals-job-changes") {
    return { data: [{ person_name: "Sam K.", new_role: String(input.new_role ?? "Head of Sales"), company_name: "Tidepool", company_domain: "tidepool.example", signal_date: day(now, 2).slice(0, 10), person_linkedin_url: "https://www.linkedin.com/in/sam-k-example" }] };
  }
  if (endpointId === "aviato-company-founders") {
    const domain = String(input.website ?? "");
    return { items: (FOUNDERS[domain] ?? []).map(([fullName, headline, slug], i) => ({ id: `p-${domain}-${i}`, fullName, headline, linkedinURL: `https://www.linkedin.com/in/${slug}` })), pagination: { page: 0, perPage: 5 } };
  }
  if (endpointId === "aviato-company-funding-rounds") {
    const domain = String(input.website ?? "");
    return { fundingRounds: (ROUNDS[domain] ?? []).map(([ago, roundName, investors]) => ({ announcedOn: day(now, ago).slice(0, 10), roundName, investors: investors.map((name) => ({ name })) })) };
  }
  return {};
}

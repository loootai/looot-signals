<p align="center"><img src="assets/hero.png" alt="looot-signals" width="100%"></p>

# looot-signals

[![License](https://img.shields.io/github/license/loootai/looot-signals)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-signals)](https://github.com/loootai/looot-signals/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to TheirStack and Harmonic style signal feeds. You define triggers ("hiring a GTM engineer", "job ads that mention Clay or n8n", "raised a seed or Series A in the last 30 days", "new head of sales"). The app pulls matching companies through looot, dedupes them, and shows a dated feed with the evidence link for each signal. Export to CSV or a webhook. A headless CLI runs the same trigger file and writes only the signals that are new since the last run.

TheirStack lists API plans from $49 a month (1,500 API credits) and one-time app credit packs from $109 (1,000 company credits), read on 2026-10-10. Harmonic shows no public price. looot-signals has no subscription. It calls looot endpoints at list price, so a run costs what its calls cost, shown before it starts.

> **Security notice.** Versions 0.1.2 and older had no admin sign-in. Anyone who could reach a deployed copy could read the stored signals, rewrite the trigger file, send the webhook and start paid looot runs on your token. If you run an older version on a reachable host, upgrade to v0.1.3 and set `SIGNALS_ADMIN_PASSWORD`. See [Securing a deployment](#securing-a-deployment).

![Signal feed, light](docs/screenshots/feed-light.png)
![Signal feed, dark](docs/screenshots/feed-dark.png)

## What you need

- Node 22.12 or newer. The repo has no `engines` field or `.nvmrc`. Next.js 16 needs 20.9 or newer and the test runner (Vitest 5) needs 22.12 or newer. I ran it on Node 24.
- npm.
- A looot account and token, only for real runs. Sign up at https://looot.ai/auth/sign-up. To get a token, run `looot login` (`npm i -g looot`), which opens a browser approval. Or in the looot web app go to Settings, "Agent tokens", and create one (https://docs.looot.ai/get-started/sign-in). With no browser or in CI, create the token in Settings, Agent tokens, then `export LOOOT_TOKEN=...`. The token needs the scopes runs.execute, catalog.read, runs.read and usage.read.
- A funded balance. Minimum top-up is $5. Signing up adds no credit (https://docs.looot.ai/money).

No other account is needed. The app does not use Supabase or an LLM key. A webhook is optional.

## Try it in one minute

No account and no token.

```bash
git clone https://github.com/loootai/looot-signals && cd looot-signals
npm install --ignore-scripts
npm run demo                              # web UI on http://localhost:3220
npm run signals -- --demo --out signals-out
```

The demo has no sign-in and shows a "Demo, no sign-in" badge. It refuses to start if `LOOOT_TOKEN` is set or `data/state.json` exists, unless you also set an admin password. The demo uses made-up companies on the reserved `.example` domain. Evidence links in demo mode go nowhere on purpose. The CLI demo prints "19 new signals. Spent $0.38 of $1.00." and writes `.json`, `.csv` and `.md` files to `signals-out/`.

The CLI demo also writes `data/state.json`. Delete `data/` before your first real run so demo signals do not count as already seen.

## Run it with your own data

```bash
cp .env.example .env.local          # web app only, then set LOOOT_TOKEN
export LOOOT_TOKEN=...              # CLI: it does not read .env.local
cp triggers.example.yaml triggers.yaml
```

The web app reads `.env.local`. The CLI reads only the shell environment.

| Variable | Required | What it does | Where to get it |
|---|---|---|---|
| `LOOOT_TOKEN` | Required for real runs, not for `--dry-run`, `--demo` or the demo UI | Bearer token for the looot API | Settings, Agent tokens in the looot app, or `looot login` |
| `LOOOT_API_URL` | Optional | looot API base URL used to read live prices. Default `https://api.looot.ai` | Leave unset |
| `SIGNALS_CAP_USD` | Optional | Most one run from the web app may spend. Default 1. The CLI uses `--cap` instead | A dollar amount you choose |
| `SIGNALS_TRIGGERS` | Optional | Trigger file the web app reads. Default `triggers.yaml`, else `triggers.example.yaml` | A path you choose |
| `SIGNALS_STATE` | Optional | State file the web app uses. Default `data/state.json` | A path you choose |
| `SIGNALS_ADMIN_PASSWORD` | Required outside the demo | Admin password, 12 characters or more. Without it the admin pages and admin API are closed and `/login` shows a setup page | Choose one |
| `SIGNALS_ADMIN_PASSWORD_HASH` | Alternative | `scrypt$salt$key` instead of the plain password. Wins if both are set | `npm run hash-password -- 'your password'` |
| `SIGNALS_SESSION_SECRET` | Optional | Key that signs session cookies. Default: derived from the password, so changing the password signs everyone out | `openssl rand -hex 32` |
| `SIGNALS_COOKIE_SECURE` | Optional | Set `0` to drop the Secure flag in production, only for plain-http testing | Leave unset |
| `SIGNALS_WEBHOOK_URL` | Optional | Receives the new signals of a run as JSON. https only, on a public host | Your own endpoint |
| `SIGNALS_WEBHOOK_SECRET` | Optional | Signs each webhook with `X-Signals-Signature: sha256=<hmac of the body>` | A secret you choose |
| `NEXT_PUBLIC_DEMO` | Optional | `1` turns on demo mode. `npm run demo` sets it | Do not set it for real use |

The trigger file is `triggers.yaml` (copied from `triggers.example.yaml`, see Triggers below). Dry run first. It needs no token and calls nothing:

```bash
npm run signals -- --dry-run
```

Real output, using `triggers.example.yaml`:

```
Calls this run (list prices dated 2026-10-10):
  gtm-engineer-hiring      anyapi-run-linkedin-jobs-thin                $0.0005  GTM engineer
  gtm-engineer-hiring      anyapi-run-linkedin-jobs-thin                $0.0005  growth engineer
  clay-n8n-job-ads         theirstack-jobs-search                       $0.3270  revenue operations, growth, Clay, n8n
  recent-rounds            predictleads-discover-financing-events       $0.2000  seed, series_a
  recent-rounds            aviato-company-founders                      $0.1000  founders of up to 2 new companies, company.founders
  recent-rounds            aviato-company-funding-rounds                $0.1000  investors in the latest round of up to 2 new companies, company.funding
  new-head-of-sales        serper-news                                  $0.0010  ("appoints" OR "names" OR "hires" OR "promotes") "head of sales"
  new-head-of-sales        serper-news                                  $0.0010  ("appoints" OR "names" OR "hires" OR "promotes") "VP sales"
  ai-sdr-news              serper-news                                  $0.0010  AI SDR launch
Total at most $0.7310 for 11 calls. Cap $1.00.
Dry run: no looot call was made and nothing was written.
```

Then the real run, and the web UI:

```bash
npm run signals -- --cap 1 --out signals-out
npm run dev                         # web UI on http://localhost:3000
```

CLI options are `--triggers`, `--out`, `--state`, `--cap` (dollars, default 1), `--format json,csv,md`, `--webhook`, `--dry-run` and `--demo`. Each run writes `signals-<timestamp>.json`, `.csv` and `.md` to the `--out` folder (default `signals-out/`) with the new signals only, and updates `data/state.json`. A real run needs a token even though the dry run does not. With no token it prints the quote and then `LOOOT_TOKEN is not set...` (see Troubleshooting).

## Spending

- The quote shows before any paid action. In the CLI it is `--dry-run`. In the UI it is a price dialog that sends back the amount you confirmed. If the live price is higher than that amount, nothing is called.
- The cap is `--cap` in the CLI and `SIGNALS_CAP_USD` in the web app. Default $1 per run. A call that would cross it is skipped and listed as `skipped_budget`.
- Typical run at list price. The five triggers in the example file cost at most $0.731 (the dry run above). That is $0.531 for the searches plus $0.20 for founder and investor lookups (2 companies x 2 lookups x $0.05). With the sample answers the same run reads as $0.38, because most searches return fewer rows than their limit and the lookups are the only part billed in full. No real run was priced.
- Founder and investor lookups are per company and run after every search, so they never use up the cap before a search has run. Each lookup is checked against the cap on its own, has its own idempotency key, and is skipped (and listed as `skipped_budget`) when it would cross the cap. A company that already has the lookup is never paid for again.
- Failed calls are not charged by looot.
- Every call has a stable `idempotencyKey` made from the trigger, the endpoint, a hash of the input and the day. Running the same trigger twice in a day replays the stored run and does not charge twice.
- A call still running when waiting stops is `pending`, never failed. Its run id is stored and read again, free, on the next run.
- Calls are pinned to one endpoint with no provider fallback, so the price is the one quoted.

## Triggers

`triggers.example.yaml` is the trigger file. Copy it to `triggers.yaml` (git ignores that name) and edit it, or edit it in the web app under Triggers. The file has a `triggers:` list with 1 to 50 entries. Each entry has these fields.

| Field | Meaning |
|---|---|
| `id` | Required. Lowercase letters, digits and dashes, up to 41 characters. Must be unique. |
| `name` | Required. Label shown in the feed, up to 80 characters. |
| `type` | Required. `hiring`, `funding`, `news` or `leadership`. |
| `source` | Optional. Picks the data source. Hiring takes `jobs_index` or `jobs_text`. Funding takes `funding` or `news`. News takes `news`. Leadership takes `news` or `job_changes`. Default is the first one listed for the type. |
| `enabled` | Optional, default `true`. The example's `head-of-sales-feed` is `false` because it costs more per call. |
| `titles` | Job titles. Hiring needs `titles` or `keywords`. |
| `keywords` | Words in the job ad. They need the `jobs_text` source, so `keywords` with `jobs_index` is an error. |
| `roles` | Roles such as "head of sales". Required for leadership. |
| `query` | Google News query. Required for news. |
| `stages` | Funding stages such as `seed` or `series_a`. Empty means any round. |
| `countries` | Optional country codes. The first one narrows the search. |
| `maxAgeDays` | Default 14, range 1 to 365. Older signals are dropped. |
| `limit` | Default 25, range 1 to 100. Rows per call. Some sources cap it at 25. |
| `enrich` | Funding triggers on the funding source only. `founders`, `investors`, or both. Runs one paid lookup per company and kind. Default none. |
| `enrichLimit` | Default 3, range 1 to 10. Most companies looked up per kind per run. The quote is the price times this number. |

The four types:

| Type | What it looks for | Default source |
| --- | --- | --- |
| hiring | Job titles, and words in the job ad | LinkedIn job index, or the job ad text search when `keywords` is set |
| funding | Financing events by stage | Financing events feed |
| news | A Google News query | Google News |
| leadership | Appointments such as "head of sales" | Google News headlines, or the structured job-change feed |

## Signals and cost

Prices are looot list prices read from the public catalog on 2026-10-10. Result-priced endpoints are quoted at the row limit of the trigger, so the real charge is usually lower.

| Signal | looot job | Endpoint | List price |
| --- | --- | --- | --- |
| Hiring by title | jobs.search | anyapi-run-linkedin-jobs-thin | $0.0005 per call |
| Hiring by words in the ad | jobs.search | theirstack-jobs-search | $0.0327 per result |
| Funding | company.funding | predictleads-discover-financing-events | $0.01 per result |
| News and leadership | news.search | serper-news | $0.001 per call |
| Leadership, structured | people.job.changes | signalbase-signals-job-changes | $0.108 per call |
| Founders of a funded company | company.founders | aviato-company-founders | $0.05 per call |
| Investors in a funded company's latest round | company.funding | aviato-company-funding-rounds | $0.05 per call |

The five triggers in the example file cost at most $0.731 per run at list price: $0.531 for the searches (0.0005 x 2 + 0.327 + 0.20 + 0.001 x 3) plus $0.20 for lookups (founders 2 x $0.05 + investors 2 x $0.05). With the sample answers the same run reads as $0.38 ($0.18 for the searches plus 4 lookups x $0.05). Treat $0.38 as an illustration. No real run was priced.

### Founders and investors

A funding trigger can look up who is behind each company it finds. Add `enrich: ["founders", "investors"]` and an `enrichLimit` to the trigger. After the searches finish, the run takes the newest companies that have a domain and no lookup yet, up to `enrichLimit` per kind, and makes one call each:

- Founders: `aviato-company-founders` (job `company.founders`), input `website`, `page: 0`, `perPage: 5`. Result: name, title and LinkedIn link per founder.
- Investors: `aviato-company-funding-rounds` (job `company.funding`), same input. Result: the investors named in the company's latest round. If that round names none, the newest round that does.

Both are billed $0.05 per call, whatever the number of founders or investors returned. The feed shows the result under the signal with the endpoint and its list price. The CSV and the webhook carry `founders` and `investors`. A company the provider returns nothing for is marked as looked up and is not charged again. A lookup that fails costs nothing and is tried again on the next run. The funding source returns a domain; the news source does not, so `enrich` is refused on it.

The catalog lists no response fields for these two endpoints and has not verified them (`verification.state` is `unverified`). The parsers read several usual field names and return nothing for an answer they do not understand. The fixtures follow the endpoint descriptions ("fundingRounds with announcedOn and the investor list"), not a captured response. Expect to adjust them on the first real run.

## Dedupe

A signal id is a hash of the signal type, the company (domain, else name) and the evidence URL with tracking parameters removed. The same job seen by two triggers or two runs is one signal. The second trigger is recorded on it.

## Export and webhook

The feed page exports the current filter as CSV (cells that start like a spreadsheet formula get a leading quote). `SIGNALS_WEBHOOK_URL` sets a webhook that receives the new signals of a run as JSON. Only https to a public host is accepted. The URL is refused if it has credentials, a non-https scheme, a name such as `localhost` or `*.internal`, or an address in a private, loopback, link-local (including the cloud metadata address 169.254.169.254), unspecified or unique-local range, in any IPv4 or IPv6 spelling, including IPv4-mapped IPv6. The host name is resolved again at send time, every answer is checked, the request goes to the address that was checked, and a redirect is not followed. A webhook receiver on your own network or on localhost is no longer accepted. With `SIGNALS_WEBHOOK_SECRET` each request carries `X-Signals-Signature: sha256=<hmac of the body>`. The URL is server config and is never taken from a request.

## Deploy

There is no `vercel.json` and no GitHub workflow in this repo. The web app keeps its state in a JSON file on disk (`data/state.json`, or `SIGNALS_STATE`) and saves trigger edits to a file, so it needs a host with a writable, persistent disk. I have not deployed it. On such a host run `npm ci --ignore-scripts && npm run build && npm start` and set `LOOOT_TOKEN` (and the optional variables) in the host environment. Set `SIGNALS_ADMIN_PASSWORD` first, see [Securing a deployment](#securing-a-deployment).

To run the CLI on a schedule, run `npm run signals -- --triggers triggers.yaml --cap 1 --out signals-out` from cron or any scheduler on a machine that keeps `data/state.json` between runs, with `LOOOT_TOKEN` exported. A fresh checkout on every run (as in a stateless CI job) would report every signal as new.

## Securing a deployment

Versions 0.1.2 and older had no admin authentication. From 0.1.3 every route is either public on purpose or admin, and the admin routes are closed unless you set a password.

### Route map

Pages and routes were listed from `src/app` and classified. A test reads the folder and fails if a route is missing from `src/lib/auth/routes.ts` or if an admin route does not call the gate.

| Class | Count | Routes |
| --- | --- | --- |
| Public by design | 4 routes | `/api/health`, `/login`, `/api/auth/login`, `/api/auth/logout` |
| Public static files | 2 | `/brand/*`, `/favicon.ico` |
| Admin pages | 3 | `/` (feed), `/triggers`, `/runs` |
| Admin API | 5 | `/api/run` (paid looot run), `/api/webhook` (sends data out), `/api/triggers` (rewrites the trigger file), `/api/export` (CSV of stored signals), `/api/quote` |

There is no inbound webhook and no server action. The webhook feature only sends, to the URL in `SIGNALS_WEBHOOK_URL`. Any path not listed is treated as admin.

### How the gate works

- `src/proxy.ts` checks every request. Each admin page, the root layout and each admin route handler checks again with the same function, so a path the matcher misses is still closed.
- Not set up (no password, and not a clean demo): admin routes answer 503, admin pages redirect to `/login`, which says what to set. Nothing stored is rendered.
- Set up: a valid session is required. Page requests without one redirect to `/login`. API requests get 401.
- Sign-in: constant-time password comparison. A session is a signed token in an httpOnly, SameSite=Lax cookie, Secure in production, valid for 8 hours. 5 wrong passwords from one address lock that address for 15 minutes. 40 wrong passwords from anywhere lock sign-in for everyone for 15 minutes (a brute-force guard that also lets an attacker delay you, so use a long password and an IP allow-list too).
- State-changing admin requests need a same-origin `Origin` header and the per-session token in `x-signals-csrf`. The layout puts the token in a meta tag and the app's own fetch calls send it.
- Money. The run cap is `SIGNALS_CAP_USD` on the server. The request body can only lower it, never raise it. A run still needs the amount confirmed on the quote. `/api/run` and `/api/webhook` allow 10 calls in 10 minutes per session.
- Admin responses carry `Cache-Control: no-store`, including the CSV export. All responses carry a Content-Security-Policy (`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The CSP allows inline scripts because Next.js needs them.
- The password and token never reach the client bundle. The server reads them at runtime.

### Setup

```bash
export SIGNALS_ADMIN_PASSWORD='a password of 12 or more characters'
# or keep it out of the environment as plain text:
npm run hash-password -- 'a password of 12 or more characters'   # prints SIGNALS_ADMIN_PASSWORD_HASH=...
```

Rotate the password by changing the variable and restarting. Changing it signs every session out. Where data is stored: `data/state.json` (or `SIGNALS_STATE`) holds signals, runs and the call log, and `triggers.yaml` holds your triggers. Both are plain files on the server's disk.

Rate limits and lockout counters live in memory in one process. Behind several instances, rate limit at your proxy too. The address comes from `x-forwarded-for`, so run the app behind a proxy that sets it and strips what clients send. Serve the app over HTTPS, because the session cookie is Secure in production.

### The stronger option

A shared password is the floor. For anything people other than you can reach, put the whole app behind a VPN, a private network or an identity-aware proxy (Cloudflare Access, Tailscale, Google IAP, oauth2-proxy). Keep the app's password on as well.

### Not covered

No per-user accounts, no roles, no audit of who signed in. The app has one admin.

## Troubleshooting

| What you see | What it means and what to do |
|---|---|
| `LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run or --demo.` | The CLI found no token. Exit code 2. Export `LOOOT_TOKEN`, or use `--dry-run` or `--demo`. |
| `Admin sign-in is not set up.` (HTTP 503) or every page redirecting to `/login` | `SIGNALS_ADMIN_PASSWORD` is missing or shorter than 12 characters. Set it and restart. |
| `The webhook must not point at a private, loopback or link-local address.` or `...resolves to a private or internal address.` | `SIGNALS_WEBHOOK_URL` points inside your network or at localhost. Use a public https endpoint. |
| `LOOOT_TOKEN is not set on the server.` | The web app run button with no token (HTTP 503). Set it in `.env.local` and restart. |
| `401: ...` or `looot returned HTTP 401` on a trigger in the run output | The token is wrong, expired or lacks a scope. Create a new one with runs.execute, catalog.read, runs.read and usage.read. |
| `402: ...` or `looot returned HTTP 402` | The balance is too low. The code shows the API's code and message and does not check this itself. Top up (minimum $5) and run again. |
| A trigger line ending in `blocked` or `stopped` | looot did not run the call. The run shows the status and the API's error if there is one. Open the run in your looot app for the reason. |
| `<id>: pending` | The call is still running at the provider. Run the same command again later. It is read again for free. |
| `skipped_budget` with `The run cap would be exceeded.` | The cap was reached. Raise `--cap` if you accept the cost. |
| `skipped_price` with `The live price could not be read, so the call was not made.` | The catalog price for that endpoint could not be read. Run again later. |
| `The price is now ... micro-dollars a run, above the ... you confirmed. Nothing was called.` | The web app price rose after you saw the quote. Open the quote again. |
| `Every call failed. See the messages above.` | Exit code 1. Read the per-trigger lines above it. |
| `The trigger file is not valid YAML: ...` or `triggers.<path>: ...` or `<id>: a hiring trigger needs titles or keywords.` | The trigger file failed the check. Exit code 2. Fix the field named in the message. |
| A call completes but finds 0 signals | The parser did not recognise the response shape, or nothing matched. Parsers return nothing for an answer they do not understand. Open an issue with the raw response. |

How to file an issue. Open one at https://github.com/loootai/looot-signals/issues with the run id (`data/state.json` stores it for each call; the Runs page does not show it), the command you used, and the raw response body with secrets removed.

## Status

- No paid looot run was made. Response parsing is built from each provider's public docs and from fixtures in `src/demo/fixtures.ts`. Parsers read several field names per value and return nothing for an answer they do not understand, but no real response body was checked. Expect to adjust them on the first real run.
- The `postedLimit` wording for the LinkedIn job index and the `date` field names of the job-change feed come from parameter descriptions, not from a live call.
- News headlines have no structured company. The company is a guess from the headline and is empty when the pattern does not fit.
- Demo and tests run against fixtures. 244 tests cover parsers, dedupe, the engine (cap, idempotency keys, pending, failures), CSV, the webhook and its address checks, the looot client, the founder and investor lookups (quote, cap, idempotency keys, pending, failures), the CLI, and the auth gate (every route closed without a session, sign-in, lockout, CSRF, spend cap and rate limit), with HTTP mocked.

If a parser fails on a real response, open an issue with the raw response body (see Troubleshooting).

## What was dropped

Founders and the investors in a company's latest round are covered since 0.1.4 (see Founders and investors). Still dropped:

- Board members, cap tables and a person-level investor graph (every company an investor backed, partner names, check sizes). I searched the free looot catalog for `board members`, `cap table`, `investor founders`, `venture capital`, `angel investors`, `investor deals` and `portfolio companies`. The closest hits are `fundable-investor-deals` and `fundable-investors` ($0.05 per result, so a portfolio costs $0.05 times its size), `signalbase-signals-investors` ($0.108 per call) and `predictleads-discover-portfolio-companies-connections` ($0.01 per result). None returns board seats or ownership, and a per-investor view would need its own screen. Not built.

## Install for agents

Copy `skills/looot-signals` into `.claude/skills/` (Claude Code) or point your agent at `llms.txt`. The skill quotes with `--dry-run`, runs with a cap, and reports new signals with their evidence links.

## Develop

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run leak-scan
```

`git config core.hooksPath .githooks` runs the leak scan before every commit.

## Licence

MIT. Copyright looot.

## Related

Other open-source projects built on [looot](https://looot.ai):

- [looot-intent](https://github.com/loootai/looot-intent): account intent and buying-stage scoring (6sense)
- [looot-score](https://github.com/loootai/looot-score): lead and ICP fit scoring (MadKudu)
- [looot-reveal](https://github.com/loootai/looot-reveal): which companies visit your site (RB2B, Clearbit Reveal)
- [looot-techstack](https://github.com/loootai/looot-techstack): website technologies from several providers (BuiltWith, Wappalyzer)
- [looot-lookalike](https://github.com/loootai/looot-lookalike): lookalike company search (Ocean.io)
- [looot-ads](https://github.com/loootai/looot-ads): competitor ad board (Foreplay)
- [looot-reviews](https://github.com/loootai/looot-reviews): review themes and weak spots (ReviewTrackers)
- [looot-battlecards](https://github.com/loootai/looot-battlecards): competitor battlecards (Klue, Crayon)
- [looot-mentions](https://github.com/loootai/looot-mentions): brand and keyword listening (Brand24)
- [looot-warm-leads](https://github.com/loootai/looot-warm-leads): warm leads from LinkedIn intent signals (Gojiberry)
- [looot-crm](https://github.com/loootai/looot-crm): a small CRM with buying signals built in
- [looot-seo](https://github.com/loootai/looot-seo): self-hosted SEO workspace
- [looot-monitor](https://github.com/loootai/looot-monitor): brand and competitor monitoring with alerts

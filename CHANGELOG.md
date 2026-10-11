# Changelog

Built from the GitHub release notes. Each version links to its release page.

## 0.1.4 (2026-10-11)

#### Founders and investors on funding triggers

A funding trigger can now look up who founded each new company and who invested in its latest round. These were dropped earlier because no looot job was found. The catalog has them.

What changed
- New trigger fields `enrich` (`founders`, `investors`) and `enrichLimit` (1 to 10, default 3). Funding triggers on the funding source only.
- `aviato-company-founders` (job `company.founders`) and `aviato-company-funding-rounds` (job `company.funding`), $0.05 per call each. One call per company and kind, after all searches have run.
- Same spending rules as the searches: quote before the run (price times `enrichLimit`), the server-side cap checked before every call, a stable idempotency key per call, pending runs read again for free, a failed call costs nothing. The cap still cannot be raised by a request.
- The feed shows founders (with LinkedIn links) and investors under the signal, with the endpoint and list price. CSV and webhook carry `founders` and `investors`.
- `triggers.example.yaml` turns it on for `recent-rounds` with `enrichLimit: 2`. The example run is at most $0.731 (was $0.531). The demo run reads $0.38 (was $0.18).
- 244 tests (was 215).

Notes
- The catalog has not verified either endpoint and lists no response fields. The parsers are tolerant and return nothing for a shape they do not understand. Expect to adjust them on the first real run.
- Still dropped: board members, cap tables and a person-level investor graph. See "What was dropped" in the README.

## 0.1.3 (2026-10-11)

#### Security release: admin sign-in

Versions 0.1.2 and older had no admin authentication. Anyone who could reach a running copy could read the stored signals, rewrite the trigger file, send the webhook and start paid looot runs on the operator's token. If you run an earlier version on a host that others can reach, upgrade to v0.1.3 and set `SIGNALS_ADMIN_PASSWORD` (12 or more characters).

What changed
- Every page and API route is public on purpose or admin. Public: `/login`, `/api/auth/login`, `/api/auth/logout`, `/api/health`, `/brand/*`. Everything else, including an unlisted path, needs a session.
- Without a password the admin routes answer 503 and `/login` shows what to set. The demo (`npm run demo`) stays open with a "Demo, no sign-in" badge and refuses to start next to a `LOOOT_TOKEN` or a `data/state.json`.
- Signed httpOnly SameSite=Lax session cookie, lockout after repeated failures, CSRF token and same-origin check on state-changing requests, 10 runs and 10 webhook sends per 10 minutes per session, no-store on admin responses, security headers.
- The outbound webhook refuses non-https URLs, credentials in the URL, localhost and internal names, and private, loopback, link-local (including 169.254.169.254), unspecified and unique-local addresses, also as IPv4-mapped IPv6. The host is resolved at send time, the request goes to the checked address, redirects are not followed.

Upgrade notes
- Set `SIGNALS_ADMIN_PASSWORD` or `SIGNALS_ADMIN_PASSWORD_HASH` (`npm run hash-password`) before starting. See "Securing a deployment" in the README.
- A webhook URL on localhost or a private network no longer works. Use a public https endpoint.

[Release page](https://github.com/loootai/looot-signals/releases/tag/v0.1.3)

## 0.1.2 (2026-10-10)

Sidebar layout: left sidebar that collapses to an icon rail, drawer on phones, spend panel, docs and GitHub links.

[Release page](https://github.com/loootai/looot-signals/releases/tag/v0.1.2)

## 0.1.1 (2026-10-10)

Dependency security bump. next and eslint-config-next 16.3.7 to 16.3.8, which fixes six Next.js advisories (GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-cjq9-62q9-8jv4). No code changes. v0.1.0 is unchanged.

[Release page](https://github.com/loootai/looot-signals/releases/tag/v0.1.1)

## 0.1.0 (2026-10-09)

First release. Trigger feed with hiring, funding, news and leadership triggers, dedupe, CSV and webhook export, headless CLI, demo mode. No paid looot run was made; parsing is built from provider docs and fixtures.

[Release page](https://github.com/loootai/looot-signals/releases/tag/v0.1.0)

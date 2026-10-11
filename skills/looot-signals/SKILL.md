---
name: looot-signals
description: Run hiring, funding, news and leadership triggers through looot and write the new signals since the last run. Use when the user wants to know which companies are hiring a role, raised a round, or appointed a new head of sales.
---

# looot-signals

Runs a trigger file once and writes only the signals not seen before.

0. Needs Node 22.12 or newer and `npm install --ignore-scripts`. Copy `triggers.example.yaml` to `triggers.yaml`. The CLI reads `LOOOT_TOKEN` from the shell, not from `.env.local`. See the README headings What you need and Troubleshooting.
1. Check `LOOOT_TOKEN` is set. If not, tell the user to create an agent token in their looot Settings, Agent tokens. Do not ask them to paste it into chat.
2. Show the price first: `npm run signals -- --triggers triggers.yaml --dry-run`. Report the total and ask for a go-ahead when it is above $0.50.
3. Run it with a cap: `npm run signals -- --triggers triggers.yaml --cap 1 --out signals-out`.
4. Read the `.md` file in `signals-out/`. Report new signals per trigger with their evidence links, the amount spent, and any call that was skipped or pending.
5. A call reported as pending is still running at the provider. Do not re-run it as failed. The next run reads it again for free.

A funding trigger can add `enrich: [founders, investors]` and `enrichLimit` to look up the founders and the latest-round investors of each new company at $0.05 per call. The dry run lists these lookups and their most expensive case; include them in the total you report.

To add a trigger, edit `triggers.yaml` (types: hiring, funding, news, leadership; see `triggers.example.yaml`). Use `--demo` to try the flow with sample data and no token.

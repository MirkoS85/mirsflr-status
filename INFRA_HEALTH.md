# MirSFlr Infra Health

This repo now has a lightweight GitHub Actions monitor:

- Workflow: `Infra Health CI`
- Runs: every 15 minutes, plus manual `workflow_dispatch`
- Link: https://github.com/MirkoS85/mirsflr-status/actions/workflows/infra-health.yml

## Where Alerts Show Up

If a critical check fails, the workflow run becomes red/failed.

You will see it in:

- GitHub Actions -> `Infra Health CI`
- GitHub email notifications, if failed workflow notifications are enabled for your GitHub account/repo
- The workflow badge, if you add or view it from GitHub

The workflow also publishes a small machine-readable status file:

- OPS JSON source: https://raw.githubusercontent.com/MirkoS85/mirsflr-status/master/api/infra-health/status.json
- GitHub Pages mirror: https://mirkos85.github.io/mirsflr-status/api/infra-health/status.json

The raw JSON source updates faster than the GitHub Pages mirror, which can lag
briefly because of caching. Both are public.

## Critical Checks

These fail the workflow and should be treated as real MirSFlr infra signals:

- `https://www.mirhollio.com/` returns OK and contains `MirSFlr`
- The Flare P-chain lists this validator in the current validator set and
  reports it as connected. Asked of `flare-api.flare.network`, not of the node:
  the network's own view is authoritative, and this repository is public, so it
  names no operator endpoint.
- `https://www.mirhollio.com/data/watch-status.json` is valid, less than 60 minutes old, and says the validator is connected

The watch feed starts showing a yellow warning in the workflow log after 20 minutes, but it only fails the workflow after 60 minutes. That avoids noisy emails when GitHub schedules are simply delayed.

Checking connectivity on-chain instead of on the node costs a little early
warning: `/ext/health` reports a process problem - bootstrapping, a bad
database - before the network notices, whereas the P-chain sees it once
connectivity actually drops. In exchange, nothing here points at the node.

## Non-Blocking Checks

These only show yellow warnings in the workflow log. They do not send a failure email by themselves because they are external dependencies:

- Flare Systems Explorer provider registry
- Oracle Daemon validator feed

## Why Not Upptime

The old Upptime `Uptime CI` ran every 5 minutes and depended on generated Upptime/GitHub Action components. It started failing before it could reliably tell whether MirSFlr infra was actually down, which caused noisy emails.

This workflow is intentionally simpler: no checkout action, no Upptime action, no generated template.

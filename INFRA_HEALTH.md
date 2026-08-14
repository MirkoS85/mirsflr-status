# MirSFlr Infra Health

This repo now has a lightweight GitHub Actions monitor:

- Workflow: `Infra Health CI`
- Runs: every 15 minutes, plus manual `workflow_dispatch`
- Link: https://github.com/MirkoS85/mirsflr-status/actions/workflows/infra-health.yml

## Where Alerts Show Up

If a critical check fails, the workflow run becomes red/failed.

You will see it in:

- MirHollio OPS dashboard: https://www.mirhollio.com/ops/
- GitHub Actions -> `Infra Health CI`
- GitHub email notifications, if failed workflow notifications are enabled for your GitHub account/repo
- The workflow badge, if you add or view it from GitHub

The workflow also publishes a small machine-readable status file:

- OPS JSON source: https://raw.githubusercontent.com/MirkoS85/mirsflr-status/master/api/infra-health/status.json
- GitHub Pages mirror: https://mirkos85.github.io/mirsflr-status/api/infra-health/status.json

The OPS dashboard reads the raw JSON source because it updates faster. The GitHub Pages mirror is public too, but can lag briefly because of caching.

## Critical Checks

These fail the workflow and should be treated as real MirSFlr infra signals:

- `https://www.mirhollio.com/` returns OK and contains `MirSFlr`
- `https://node.mirhollio.com/flare/ext/health` returns JSON with `healthy: true`
- `https://www.mirhollio.com/data/watch-status.json` is valid, less than 60 minutes old, and says the validator is connected

The watch feed starts showing a yellow warning in the workflow log after 20 minutes, but it only fails the workflow after 60 minutes. That avoids noisy emails when GitHub schedules are simply delayed.

## Non-Blocking Checks

These only show yellow warnings in the workflow log. They do not send a failure email by themselves because they are external dependencies:

- Flare Systems Explorer provider registry
- Oracle Daemon validator feed

## Why Not Upptime

The old Upptime `Uptime CI` ran every 5 minutes and depended on generated Upptime/GitHub Action components. It started failing before it could reliably tell whether MirSFlr infra was actually down, which caused noisy emails.

This workflow is intentionally simpler: no checkout action, no Upptime action, no generated template.

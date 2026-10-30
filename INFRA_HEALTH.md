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

- https://raw.githubusercontent.com/MirkoS85/mirsflr-status/master/api/infra-health/status.json

There used to be a GitHub Pages mirror of this file. It was published by an
Upptime workflow that no longer exists, so the raw URL above is the only
source.

## Public payload publication guard

Before any publication request, an explicit field/type allowlist validates the
complete payload, including historical v1 fields. It does not filter, rename,
coerce or redact approved values. New fields, malformed structures and custom
JSON serializers block the entire publication; rejected keys and values are not
included in the guard's error. Missing publication credentials or repository
context also fail the run.

Public diagnostics are constructed from controlled descriptions before logging.
Unexpected schema/status objects, parser excerpts, raw exception messages,
stacks, causes, HTTP response bodies and server-supplied reason phrases are not
echoed. Standard HTTP reason constants and valid diagnostic values retain their
existing wording. Unsafe or malformed inputs may produce a generic description
instead; JSON field names/types and health decisions remain unchanged.

Check URLs must match the approved static check mapping before they are logged
and again before publication. Monitor URLs must match their approved values.
Approved URLs are not normalized or rewritten. Historical JSON records are not
modified. This remains a bounded publication policy, not a general-purpose
secret scanner for every possible future public string.

Failure logs distinguish `invalid-input`, `health-check-failure`,
`public-contract`, `publication` and unexpected `monitor-execution` failures.
Actions annotations are escaped; arbitrary Error objects are not logged.
No workflow summary or additional public endpoint is introduced.

A rejection emits a GitHub Actions error annotation and exits with code 1. The
previous public JSON remains unchanged and can still say `overall: "ok"`. This
is a monitoring/publication failure, not confirmation of an infrastructure
outage. A GitHub API failure also fails the run; if a write request loses its
response, whether the write reached GitHub cannot be inferred from that failure.

Failed-run notifications depend on GitHub account settings and delivery; they
do not guarantee timely operator notification. A job that never starts cannot
report its own failure. Independent freshness monitoring remains a separate
Phase 2 task; no watchdog, new service or fallback publisher is added here.

Offline regression tests (mocked network only):

```sh
node --test tests/public-status-contract.test.cjs
```

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

The old Upptime `Uptime CI` ran every 5 minutes and depended on generated
Upptime/GitHub Action components. It started failing before it could reliably
tell whether MirSFlr infra was actually down, which caused noisy emails.

It was removed entirely in October 2026. By then its checking workflow had not
run since 14 August, while the status page it generated kept reporting "up" and
"100% uptime" from history frozen on 31 August - stale figures presented as
current, which is worse than publishing nothing.

This workflow is intentionally simpler: no checkout action, no Upptime action,
no generated template.

# MirSFlr infrastructure status

Automated public checks for [Mirhollio Core](https://www.mirhollio.com) (formerly
MirSFlr), an independent Flare validator and FTSO provider.

One workflow, `Infra Health CI`, runs every 15 minutes and publishes what it
found to [`api/infra-health/status.json`](api/infra-health/status.json).

## What is checked

| Check | Source | Blocking |
|---|---|---|
| Website reachable, serving the expected content | `www.mirhollio.com` | yes |
| Validator connected, with its network-measured uptime | Flare P-chain | yes |
| Watch feed valid, fresh and reporting the validator connected | `www.mirhollio.com/data/watch-status.json` | yes |
| Provider registry reachable | Flare Systems Explorer | no |
| Validator metrics feed reachable | Oracle Daemon API | no |

A blocking check that fails turns the workflow run red, which sends the usual
GitHub failure notification. Non-blocking checks only log a warning, because an
external dependency being slow is not this operator's outage.

Validator connectivity is asked of the **Flare P-chain**, not of the node. The
network's own view is authoritative rather than self-reported, and it means this
public repository names no operator endpoint.

## Reading the result

```
https://raw.githubusercontent.com/MirkoS85/mirsflr-status/master/api/infra-health/status.json
```

The payload carries an `overall` verdict, a one-line `summary`, and a `checks`
array where each entry has its own status, message and timestamp.

## History

This repository was previously built on [Upptime](https://upptime.js.org). That
layer was retired: its checking workflow last ran on 14 August 2026, while the
generated status page kept rendering "up" and "100% uptime" from history frozen
on 31 August. A status page that reports stale figures as current is worse than
no status page, so it was removed rather than left running.

## Rights

Public so the checks can be read and verified. No licence is granted and no
rights are transferred.

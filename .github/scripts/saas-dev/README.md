# SaaS dev workflow consumers (SNP-836)

This is an **opt-in repair for the existing SaaS dev host**, not a general Cloud
worker configuration or a Staging/Production deployment change. It never starts,
stops, scales, or restarts containers and never enqueues, deletes, or consumes jobs.

## Why

The host's `/home/ubuntu/langgenius/docker-compose.yaml` explicitly sets the main
worker's `CELERY_QUEUES`. This overrides the image defaults and omits
`workflow_professional`, `workflow_team`, and `workflow_sandbox`. An allowed
Webhook can therefore return HTTP 200 while its workflow remains queued.

The repair appends only these three queues to the existing main worker setting.
It preserves the existing ten queues, their order, comments, quoting, all other
file bytes, file owner/group/mode, the two worker replicas, and every other
service. It intentionally rejects a different or ambiguous baseline for review.

Do **not** remove `CELERY_QUEUES`, enable all default queues, or change the shared
image entrypoint. Dedicated Cloud workers elsewhere must not start competing for
other queues. In the 2026-09-20 dev audit, `schedule_poller`, `schedule_executor`,
and `trigger_refresh_publisher` each already contained more than 51,000 messages.
Those queues and their data are outside this repair's scope.

## Prerequisites and dry-run

Requirements: Python 3.10+, PyYAML, Docker Compose v2, and access to the existing
`langgenius-api-1` and two main worker containers. PyYAML was already installed on
the audited host; no new package or credential is required. The existing API
image supplies its Redis client. Resolved Compose configuration and broker
credentials are processed only in memory, never printed or saved by the repair.

From the repository root, run the script over SSH. Omitting `--apply` is a
dry-run: the target and services are unchanged. A temporary validation candidate
in the same directory is removed after validation.

```sh
ssh -T -i /Users/yansongzhang/.ssh/id_rsa -o IdentitiesOnly=yes \
  ubuntu@ec2-100-30-236-187.compute-1.amazonaws.com \
  'python3 - --target saas-dev' \
  < .github/scripts/saas-dev/fix_workflow_queues.py
```

Every dry-run and apply performs these fail-closed preflight checks:

- The target is precisely `/home/ubuntu/langgenius/docker-compose.yaml`, a regular
  file, not a symlink or hardlink. `services.worker.environment.CELERY_QUEUES`
  occurs exactly once and is an explicit, single-line string.
- The resolved candidate differs only in that one environment value. The worker
  is Cloud, and `CELERY_WORKER_QUEUES` does not override the intended setting.
- Exactly two running main worker containers match the existing Compose project
  and file. Their real PID 1 `-Q` arguments match their environment and contain
  only the reviewed original queues and the three approved workflow queues.
- Compose API/worker and running API/worker broker URLs match exactly in memory.
  Redis prefixes, Sentinel, custom TLS, or a different topology fail closed;
  review these explicitly instead of checking the wrong broker/namespace.
- All three workflow queues, including Redis priority suffix keys, have **zero**
  messages. Both broker `unacked` and `unacked_index` must also be **zero**.

If any guard fails, stop and inspect the cause. Do not purge queues, remove
messages, restart consumers, or weaken the guard to make the repair pass. A
nonzero `unacked` count may be legitimate in-flight work; wait for it to finish
and rerun the read-only check. The check is a snapshot, not a lock on producers;
recheck immediately before the planned worker deployment.

## Apply and deploy

Review the dry-run's old/new queue lists and `before_sha256`. Apply requires that
exact SHA256 plus the explicit target and apply flag:

```sh
ssh -T -i /Users/yansongzhang/.ssh/id_rsa -o IdentitiesOnly=yes \
  ubuntu@ec2-100-30-236-187.compute-1.amazonaws.com \
  'python3 - --target saas-dev --apply --expected-sha256 REVIEWED_SHA256' \
  < .github/scripts/saas-dev/fix_workflow_queues.py
```

The script validates first, verifies the original content again, writes an exact
same-directory backup with the original owner/group/mode, then atomically
replaces the target and verifies the resulting bytes. It prints the concrete
backup path, hashes, queue names, and `services_restarted: false`. Treat the
backup as sensitive: it contains the original Compose configuration and must not
be committed or attached to an issue. Record only its path and hash in the
deployment report. An already-patched file is a no-op without another backup.

This repository's `deploy-saas.yml` executes the configured
`SSH_SCRIPT_SAAS_DEV`; the audited script pulls and recreates the normal API,
Web, main worker, priority worker, and plugin worker services from this existing
host Compose file. It does not replace that file, so the queue change persists
through subsequent `deploy/saas` deployments. Keep the repair and API changes on
the original PR and synchronize to `deploy/saas` through the normal reviewed
workflow. Do not change the deployment script variable, pipeline settings,
Staging/Production manifests, or unrelated service configurations for this fix.

## Regression checklist

1. After the normal deployment, inspect the two main worker PID 1 queue arguments:
   the original ten queues plus exactly the three workflow queues must be present;
   replica count and other workers' queue arguments must be unchanged.
2. Create a disposable, no-model Webhook → End workflow. Bind a denying IP policy:
   a request must return 403 and produce no workflow run or trigger log.
3. Permit only the test source IP and send **one** Webhook request. HTTP 200 alone
   is insufficient: verify the trigger log and workflow run reach `succeeded`,
   with zero model tokens and no residual workflow queue message.
4. Restore a denying policy, verify 403 and unchanged run count; confirm the
   existing Web/API/MCP access-control regressions remain correct.
5. Clean up only the disposable test resources through their normal lifecycle.
   Do not clear shared queues, historical messages, or unrelated user data.
6. Confirm none of the excluded schedule/refresh queues gained a consumer. Their
   lengths can grow naturally while the beat process continues producing tasks;
   growth is not a reason to consume or purge them during this fix.

If rolling back, first check for running/pending workflow work and obtain approval
for any service operation. Inspect the exact backup path printed by the apply;
verify that the live file still has the recorded `after_sha256` before restoring
it, so another person's intervening edits are not overwritten. Restore the
backup with owner/group/mode preserved, validate Compose without printing its
secret-bearing output, and use the normal worker deployment procedure. This
script deliberately provides no automatic destructive rollback or queue purge.

## Local tests

```sh
uv run --project api pytest api/tests/unit_tests/commands/test_fix_workflow_queues.py
```

Tests use temporary synthetic Compose files and mocked broker responses. They
do not contact dev, invoke Docker, or use real credentials.

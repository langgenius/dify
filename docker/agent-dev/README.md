# Agent dev deployment

These are the source copies of `/home/ubuntu/langgenius/deploy.sh` and
`verify_deploy.py` on agent dev. Install the two files together, under the
existing `.agent-dev-config-mutation.lock`; retain a private backup before
replacing an installed file. The Compose files and environment remain on the
server. Run `python3 docker/agent-dev/test_deploy.py` for the isolated deployment
checks; it does not connect to Docker or touch shared services.

The deployment script pulls the published `deploy-agent` images for API,
ordinary workers, priority worker, plugin worker, Beat, external-agent worker,
agent backend, and web. Local build overrides must be removed. It preserves
existing replica counts and does not update shared infrastructure or remove
unrelated containers.

All image revision labels must agree. An optional `DEPLOY_EXPECTED_REVISION`
also pins the expected source revision. After replacement, every container
must use the inspected image ID and pass API, runtime/Redis, and web checks.
Failure at any stage returns a nonzero exit status to the SSH workflow.

`MIGRATION_ENABLED=false` remains explicit. Review and apply required database
migrations before a deployment; the compatibility gate rejects missing known
schema before replacing running containers. Do not fix a failed gate by
stamping Alembic revisions or restoring old local-image build overrides.

All other tools that change this shared environment must hold the same
`.agent-dev-config-mutation.lock` without replacing its inode.

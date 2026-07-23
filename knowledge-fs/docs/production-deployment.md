# KnowledgeFS Production Deployment

KnowledgeFS has one supported production topology: an internal backend service deployed as part of
Dify. It has no independent SaaS, private-cloud, or single-host deployment mode.

The existing Dify knowledge-base feature and KnowledgeFS intentionally coexist during rollout.
This deployment does not migrate, replace, or delete existing Dataset/Document data.

## Dependency ownership

| Capability | Owner | KnowledgeFS access |
|---|---|---|
| Model configuration and credentials | Dify model manager / Plugin Daemon | Dify inner model API |
| Datasource configuration, OAuth, and credentials | Dify datasource plugins | Dify inner datasource API |
| Physical object storage | Dify `STORAGE_TYPE` implementation | Dify inner storage API |
| KnowledgeFS relational state | KnowledgeFS database | `DATABASE_URL` |
| Complex document parsing | Unstructured-compatible service | `UNSTRUCTURED_API_URL` |
| Capability signing | Dify | Public JWKS only in KnowledgeFS |

KnowledgeFS must never receive model-provider keys, datasource secrets, direct Plugin Daemon
credentials, or object-storage provider credentials.

## Dify Compose

The canonical service definitions are:

- `docker/docker-compose.yaml`
- `docker/docker-compose-template.yaml`
- `docker/envs/core-services/knowledge-fs.env.example`

The Compose service:

- starts by default with the rest of Dify;
- builds `knowledge-fs/apps/api/Dockerfile` when a prebuilt image is unavailable;
- remains on the internal `default` network and exposes only port `8787` to peer services;
- receives `DIFY_INNER_API_URL=http://api:5001`;
- receives the same inner API key used by Dify's plugin boundary;
- waits for the Dify API and its database dependency;
- uses `/health` for liveness and `/ready` for traffic readiness.

`KNOWLEDGE_INTEGRATED_MODE_ENABLED` controls Workspace provisioning/cutover behavior only. Whether
it is `false` or `true`, model, datasource, and object-storage calls always go through Dify.

## Operator-owned environment

The tracked KnowledgeFS environment example intentionally contains only settings that belong to
the service:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | KnowledgeFS PostgreSQL connection string. |
| `KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME` | Durable document worker rollout. |
| `KNOWLEDGE_FS_CAPABILITY_V2_ENABLED` | Capability-v2 verifier rollout. |
| `KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS` | Public verification key set issued by Dify. |
| `UNSTRUCTURED_API_URL` | Parser endpoint for complex formats. |
| `UNSTRUCTURED_API_KEY` | Optional parser authentication. |

Compose injects `DIFY_INNER_API_URL` and `DIFY_INNER_API_KEY`; do not duplicate them in the
operator-owned env file. Do not add `MINIO_*`, cloud object-storage credentials, provider API keys,
`PLUGIN_DAEMON_*`, datasource tokens, or OAuth client secrets.

## Database release

Apply checked-in KnowledgeFS migrations through the controlled migration runner before scaling a
new binary:

```bash
pnpm db:migrations:check
pnpm local:db:migrate
```

Use the environment's normal migration job in production rather than running the local command
from an application container. The KnowledgeFS migration runner owns only KnowledgeFS tables. It
must not mutate existing Dify Dataset/Document tables or perform a production data migration.

Keep destructive legacy-removal flags disabled until the separately approved zero-traffic,
backup/restore, DBA, and CAB gates are complete.

## Readiness contract

Production `/ready` fails closed unless all enabled capabilities are assembled. The base checks
include:

- an authentication verifier;
- Dify model-runtime configuration;
- Dify datasource-runtime configuration;
- Dify object-storage configuration;
- durable database repositories required by enabled workers and product routes.

`/health` is liveness and component diagnostics; it is not permission to receive production
traffic. A service with `/health=200` and `/ready=503` must remain out of rotation.

Direct upload remains disabled because the Dify storage bridge deliberately does not expose
provider-specific presign or multipart primitives. Upload bytes pass through the bounded
KnowledgeFS API and Dify inner storage API.

## Release validation

Before publishing an image:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint:backend
pnpm openapi:export:test
pnpm db:migrations:check
pnpm dify:compose:config
pnpm docker:api:build
pnpm docker:api:bundle-smoke
git diff --check
```

The isolated bundle smoke is not a production dependency test. In a Dify-connected environment,
also verify:

1. `/health` and `/ready`.
2. A tenant-scoped KnowledgeSpace create/read.
3. A bounded document upload and object read through Dify storage.
4. Embedding, rerank, LLM, and model-catalog calls through Dify model instances.
5. Datasource validation/browse through a Dify-managed `credentialId`.
6. No model, datasource, OAuth, Plugin Daemon, or storage credentials appear in KnowledgeFS
   environment variables, requests, logs, or database rows.
7. Existing Dify knowledge-base flows remain unchanged.

## Workspace rollout

Roll out Workspace by Workspace. Keep the integrated-mode/capability flags disabled by default,
then enable only after the selected Workspace has:

- durable KnowledgeFS provisioning state;
- capability verification;
- successful model, datasource, and storage smoke;
- rollback evidence and monitoring ownership.

The rollout flag changes admission and provisioning behavior. It does not switch transports and
does not authorize a fallback runtime.

## Kubernetes

`infra/kubernetes/dify-integration-baseline.yaml` is an inert reference with zero replicas, an
internal `ClusterIP`, fail-closed probes, and no public ingress. A downstream Dify deployment may
adopt it only while preserving the same ownership boundaries.

## Rollback

Rollback the KnowledgeFS image or disable the affected Workspace cutover. Preserve KnowledgeFS
database rows and Dify-owned objects unless a reviewed recovery procedure says otherwise. Do not
rotate the Dify inner key, delete existing knowledge-base data, or redirect KnowledgeFS to a direct
storage/plugin endpoint as a rollback shortcut.

After rollback, rerun Dify-connected health and tenant smoke, confirm the existing knowledge-base
feature is unaffected, and record the release and rollback evidence.

# KnowledgeFS Celery workers

## Ownership

In `KNOWLEDGE_BACKGROUND_EXECUTION=celery` mode KnowledgeFS API replicas serve requests but do
not start document, source, Research, preview, quality, deletion or maintenance timers. Dify's
existing Celery broker and Beat dispatch the background work. Each **prefork child** runs one
bundled TypeScript engine locally over private stdin/stdout. This is not a long-running HTTP
callback into an API Pod, and does not introduce another worker image family or a shell CLI.

The engine is included in `api/Dockerfile`, together with the existing native parser worker,
Poppler and image worker. Dify API, Beat and KnowledgeFS Celery roles must use the same updated
API image revision. The standalone KnowledgeFS API image must be built from that revision too.
No database migration is introduced by this change; existing KnowledgeFS migrations are required.

| Queue | Responsibility | Compose concurrency per replica |
| --- | --- | --- |
| `knowledge_fs_document` | Document compilation, semantic enrichment, PageIndex repair, profile migration | 2 |
| `knowledge_fs_source` | Source workflow execution and previews | 1 |
| `knowledge_fs_research` | Durable Research and quality replay | 2 |
| `knowledge_fs_maintenance` | Deletion, reconciliation, cleanup, backfills, queued findability evaluation | 1 |
| `knowledge_fs_dispatch` | Outbox delivery and due-source scheduling | 1 |

Document compilation and findability evaluation are individual Celery delivery messages. The
remaining operations are bounded **database-claim sweeps** delivered by Beat, not one broker
message per database row. Source and Research sweeps claim one execution at a time; other
maintenance operations retain their existing bounded batches. There is no sleeping poll loop in
an API or worker engine. Beat emits recoverable wakeups every 5 seconds (configurable 1–60 seconds);
unused wakeups expire, while actual document delivery messages do not expire.

Celery task success means the delivery/sweep completed. Document/domain success, progress and
failure classification remain in the KnowledgeFS database and its background-task UI. Do not
replace those states with Celery task states.

## Required configuration

All new roles require the standard Dify worker environment (Dify DB/broker/security configuration),
plus the **same KnowledgeFS runtime environment as its API**: dedicated `DATABASE_URL`, public
JWKS, Dify inner API origin/key, parser endpoints, durability flags, model/asset size limits and
runtime timeouts. Never point that URL at Dify's application database. Model, datasource and
object-storage operations still go through Dify. The Node child does not inherit control-plane
private signing keys, `NODE_OPTIONS`, or arbitrary shell hooks. Python Dify configuration still
needs its normal secrets; its capability flag validation is unchanged.

Set these consistently before cutover:

```dotenv
# KnowledgeFS API and the new worker roles
KNOWLEDGE_BACKGROUND_EXECUTION=celery
KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME=on

# Dify API, existing workers, new workers, and the single existing Beat
KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED=true
CELERY_BROKER_VISIBILITY_TIMEOUT=10800
KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS=7200
KNOWLEDGE_FS_BACKGROUND_POLL_INTERVAL_SECONDS=5
```

Redis/Sentinel visibility must be identical on **all** Celery processes sharing the broker and
must exceed the engine soft timeout + 30-second hard-limit margin. Startup rejects an unsafe
configuration when the feature is enabled. Existing deployments retain their current Celery
visibility when this optional setting is unset and the rollout is disabled. Raising visibility
also changes broker-only recovery latency for other late-acknowledged tasks sharing that Redis
namespace; evaluate that tradeoff. RabbitMQ operators must separately configure consumer delivery
acknowledgement timeout above the hard task limit.

Use `prefork`, prefetch `1`, and separate source/document worker pools. The entrypoint rejects
gevent, missing local engine/database configuration, disabled durable compilation and mixed
source/document queues. Source workflows wait for child documents, so a shared pool can starve.
Keep dispatch separate from slow processing as well. One Beat owner is required; use the existing
Dify Beat rather than starting one scheduler per worker Pod.

`knowledge-fs-worker.env.example` defaults the unclaimed compilation outbox visibility to 3 hours
to avoid frequent republishing while messages wait in a busy broker. Queue redelivery preserves
the same ID across publisher Pods. The publisher's database claim lock remains at most 30 seconds,
independent of that backlog window; once execution starts, heartbeat updates own the outbox's
next recovery time. Celery itself does not deduplicate IDs: database leases,
row-version fences, checkpoints and terminal-state checks prevent duplicate publication. Broker
publication failure never reports a successful enqueue; the durable outbox remains recoverable.

## Compose

Copy the new `docker/envs/core-services/knowledge-fs-worker.env.example` to the corresponding
`.env` file without overwriting existing files. Existing root `docker/.env` takes precedence over
service env files. Put rollout flags, visibility and an immutable `KNOWLEDGE_FS_WORKER_IMAGE` in
the root override, matching the image configured for Dify API and Beat. The default public image
tag in Compose is not proof that your registry contains this change.

After the controlled cutover below, start profile `knowledge-fs-celery`. It contains all five
worker roles; the Unstructured service/profile remains separate and unchanged. Scale, for example,
`knowledge_fs_document_worker` independently of `knowledge_fs_source_worker` with Compose's
`--scale`. `KNOWLEDGE_FS_DOCUMENT_WORKER_CONCURRENCY`, `KNOWLEDGE_FS_SOURCE_WORKER_CONCURRENCY`,
`KNOWLEDGE_FS_RESEARCH_WORKER_CONCURRENCY`, `KNOWLEDGE_FS_MAINTENANCE_WORKER_CONCURRENCY` and
`KNOWLEDGE_FS_DISPATCH_WORKER_CONCURRENCY` override per-replica defaults.

## Kubernetes and capacity

`infra/kubernetes/celery-workers.yaml` is an **inert reference**, with all five Deployments at zero
replicas and no public ports. Replace the image with a built digest and adapt the operator-owned
`dify-worker-runtime` / `knowledge-fs-runtime` ConfigMap/Secret references to your deployment.
Its resource values are starting points for measurement, not guaranteed capacity. It uses one
child per Pod and a long termination grace period so a normal rollout can finish a long document.
Forced eviction/OOM still uses redelivery and durable recovery. No live deployment is performed
by checking in this reference.

- Active document deliveries ≈ document Pod replicas × Celery child concurrency. Supplemental
  document-queue maintenance consumes some of those slots.
- Parser/model/memory gates are **per child engine**, not cluster-wide. At a model gate of 16,
  three Pods × two children can admit up to 96 gated model requests. Keep the model provider and
  shared Unstructured capacities in step with worker scaling; Celery is not a distributed provider
  rate limiter.
- Each child also owns its own DB pool (`POSTGRES_POOL_MAX`, default 10). Include API and every
  worker role when budgeting DB connections and memory. More Pods do not remove parser bottlenecks.
- Autoscaling document workers can use broker queue depth/oldest age plus active work. Source,
  Research and maintenance additionally need **durable DB backlog/age metrics**: their periodic
  wakeup queue lengths are not the number of pending domain tasks. A short sweep cadence also
  bounds dispatch throughput; tune it from measurements rather than only adding replicas.
- Avoid immediate scale-to-zero for dispatch/maintenance/source/Research: pending work can exist
  only in the database. Keep a minimum replica or configure a database-aware activation metric.
- Worker recycling defaults to 1,000 Celery tasks for these roles, instead of 50. Cheap idle
  sweeps otherwise repeatedly discard a warm engine. Adjust after observing RSS and startup cost.

## Controlled rollout and acceptance

1. Build both images from the same revision. Verify engine/parser bundles and dependencies are in
   the API image. Deploy updated publisher/Beat code with the background flag **false** initially.
2. Schedule a cutover window: pause new imports, source syncs and durable Research starts, and
   drain currently executing embedded work. Do not start a Celery Beat sweep owner alongside
   embedded executors. Database fencing is a safety net, not a reason to run both modes.
3. Change every KnowledgeFS API replica to `celery`, drain/remove all old embedded replicas, and
   apply the shared broker configuration to Dify API/workers/Beat. API readiness may be unavailable
   until the publisher flag is enabled; this is a controlled transition, not a zero-downtime promise.
4. Enable the publisher and Beat flag and start all five worker roles with the matching runtime
   configuration. Keep product writes paused until acceptance passes. Authenticated
   `/inner/api/knowledge-fs/background/health` checks publisher enablement and broker connectivity;
   it does **not** certify that consumers or model/parser dependencies are healthy.
5. Verify worker registered/active queues, actual domain-task progress and no embedded API timers.
   Run small TXT/HTML, Office and PDF import canaries; source sync waiting for compilation;
   durable Research; retry/cancel/delete; outline/quality and overview failure propagation.
6. With at least two document Pods, kill a canary worker during execution, wait for lease recovery,
   and confirm one published generation and resumed progress. Also test broker outage/recovery and
   messages queued longer than one outbox visibility window. These require a test deployment and
   are not replaced by local mocked-broker tests.
7. Resume writes and scale gradually using latency, backlog, provider quota, parser memory and DB
   connection observations. Monitor expired leases, repeated retries, broker errors and worker OOMs.

## Rollback

Pause new writes and scheduled source admissions. Drain active operations and document/findability
deliveries while keeping their publishers, dispatch sweeps and consumers available for child work.
Only disable Beat sweeps and stop workers after the dependency chains are quiescent and durable
terminal/lease state has been verified. Never purge the broker or reset job
rows just to hide pending work. Restore `embedded` only after Celery execution is stopped, using
one KnowledgeFS API replica for the legacy process-local queue. Turn off the background publisher
flag and resume traffic after canaries. If broker failure prevents a clean drain, preserve queued
messages and reconcile database state before deciding whether rollback or recovery is safer.

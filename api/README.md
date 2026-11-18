# Dify Backend API

## Setup and Run

[`uv`](https://docs.astral.sh/uv/), Docker Compose, and the Node.js and pnpm versions pinned in the root `package.json` are required. Run the commands below from the repository root, with each long-running service in its own terminal.

### Using scripts (recommended)

1. Run setup for a new checkout (copies env files and installs dependencies). This overwrites `api/.env`, `web/.env.local`, and `docker/middleware.env`; preserve existing configuration before rerunning it.

   ```bash
   ./dev/setup
   ```

1. Review `api/.env`, `web/.env.local`, and `docker/middleware.env` values (see the `SECRET_KEY` note below).

1. Start middleware (PostgreSQL/Redis/Weaviate).

   ```bash
   ./dev/start-docker-compose
   ```

1. Start backend (runs migrations first).

   ```bash
   ./dev/start-api
   ```

1. Start Dify [web](../web) service.

   ```bash
   ./dev/start-web
   ```

   `./dev/setup` and `./dev/start-web` install JavaScript dependencies through the repository root workspace, so you do not need a separate `cd web && pnpm install` step.

1. Set up your application by visiting `http://localhost:3000`.

1. Start the worker service (executes queued async tasks).

   ```bash
   ./dev/start-worker
   ```

1. Start Celery Beat when scheduled tasks are needed. This is required when
   `KNOWLEDGE_FS_LIFECYCLE_WORKER_ENABLED=true` so provisioning and deletion
   outbox commands are dispatched to the lifecycle worker.

   ```bash
   ./dev/start-beat
   ```

### Environment notes

> [!IMPORTANT]
>
> When the frontend and backend run on different subdomains, set COOKIE_DOMAIN to the site’s top-level domain (e.g., `example.com`). The frontend and backend must be under the same top-level domain in order to share authentication cookies.

Leave `SECRET_KEY` empty to let Dify generate a persistent key in the storage directory. To manage it explicitly, generate a value with `openssl rand -base64 42` and set `SECRET_KEY` in `api/.env`.

### Timezones and local-time conversion

The backend uses `zoneinfo` with the system IANA timezone database, falling back to the explicitly required `tzdata` package. `LOG_TZ` is validated when configuration loads. Valid names and aliases are accepted, and differently cased names such as `utc` and `asia/shanghai` are resolved to their canonical spelling when needed. Unknown nonempty values are rejected; they never silently fall back to UTC. Explicit `None` and empty-string values retain their existing unset behavior.

When parsing a local time without an explicit UTC offset, `parse_time_range` and the Time conversion tools apply these rules:

- A repeated time resolves to its **later occurrence**.
- A nonexistent time shifts **forward by the actual size of the timezone transition**, preserving its position within the gap. The returned local time is normalized to a real wall-clock time.

The `pytz` migration intentionally changes the repeated-hour choice in `Europe/Dublin`: `2024-10-27 01:30` now resolves to `01:30Z` (`01:30+00:00`), whereas the previous `is_dst=False` policy selected `00:30Z` (`01:30+01:00`). Both instants exist; the new policy consistently chooses by chronological order rather than by the timezone database's DST label. New York's existing later-occurrence behavior is preserved.

## CPython GC metrics

Enable `ENABLE_OTEL` and configure the existing OTLP metric endpoint. The standard
`SystemMetricsInstrumentor` supplies `cpython.gc.collections`,
`cpython.gc.collected_objects` and `cpython.gc.uncollectable_objects`, by generation.
GC metrics are independent of trace sampling and use the existing OTel provider,
collector and `OTEL_METRIC_EXPORT_INTERVAL` (milliseconds, default 60000).
Preserve `process.pid` and Pod/container resource identity when comparing workers
or blue/green deployments; a PID alone is not unique across Pods.

The small GC callback adapter adds:

| Metric | Meaning |
| --- | --- |
| `cpython.gc.count` | Scheduling counters by generation, not live object counts |
| `cpython.gc.threshold` | Active GC thresholds by generation |
| `cpython.gc.enabled` | Whether automatic cyclic GC is enabled |
| `dify.gc.duration` | Collection elapsed-time histogram in seconds, by generation |
| `dify.gc.duration_samples_dropped` | Duration samples overwritten before SDK collection, by generation |

The GC callback only timestamps events and appends to a bounded 4096-sample buffer
per generation, so frequent young collections cannot overwrite full-collection
durations. An OTel observable callback publishes the samples into the histogram
during the existing SDK collection cycle. This avoids reentering SDK aggregation
locks from GC, without adding a publisher thread, exporter or collection timer.
Cleanup stops GC callbacks before the final telemetry flush, which can still drain
pending samples. The default Gunicorn and Celery gevent workers initialize these
instruments with the application. Prefork children inherit the existing OTel
resource, which can include the parent's `process.pid`; this change does not add
per-child provider initialization.

Check dropped samples before interpreting histogram counts, sums or quantiles:
they cover retained samples only. Native GC counters remain complete when duration
buffers overflow. Metric collection never calls `gc.collect()`, `gc.get_objects()`
or `gc.get_freeze_count()`. This adapter targets Dify's GIL-enabled CPython 3.13
runtime with OTel SDK 1.44.0 and system-metrics instrumentation 0.65b0. It does not
change automatic collection, thresholds or object lifetimes.

With standard OTLP-to-Prometheus name translation:

```promql
# Full-GC elapsed seconds per second, retaining process and Pod labels.
rate(dify_gc_duration_seconds_sum{generation="2"}[5m])

# Full-GC p95 across selected workers; sparse windows may have too few samples.
histogram_quantile(0.95, sum by (le) (
  rate(dify_gc_duration_seconds_bucket{generation="2"}[5m])
))
```

Filter or group by deployment/Pod identity when comparing blue and green groups.
Correlate collection frequency, cumulative duration and pause distribution with
request volume, workload mix, CPU, RSS and request latency. These metrics exclude
ordinary reference-counting destruction. They provide observability and do not
establish a performance improvement on their own.

## Testing

Test real production behavior with real objects. Do not use mocks, `SimpleNamespace`, or other shortcuts that bypass real testing.

Backend unit-test directories must exactly mirror the production code's relative directory structure, and filenames must match the production filenames with a `test_` prefix. For example, `api/libs/schedule_utils.py` maps to `api/tests/unit_tests/libs/test_schedule_utils.py`.

Apply the same rule to provider-local suites: `<provider>/src/<package>/module.py` maps to `<provider>/tests/unit_tests/src/<package>/test_module.py`.

Run from the repository root:

```bash
uv sync --project api --group dev
make test
make test TARGET_TESTS=./api/tests/unit_tests/<path>
make lint
make type-check
```

`make test` includes provider unit tests and runs controller tests separately. Integration suites are CI-only and are not expected to run locally. Test environment defaults live in `api/pyproject.toml` under `tool.pytest_env`; see the backend [agent guide](AGENTS.md) for package conventions.

## API contracts

The [API schema guide](controllers/API_SCHEMA_GUIDE.md) owns schema changes and verification. Generate the OpenAPI specifications and TypeScript/Zod contracts through the workspace script:

```bash
pnpm -C packages/contracts gen-api-contract
```

Refresh the checked-in Markdown reference with:

```bash
uv run --project api python api/dev/generate_swagger_markdown_docs.py \
  --swagger-dir packages/contracts/openapi --markdown-dir api/openapi/markdown --keep-swagger-json
```

Update the backend schema owner and regenerate contracts instead of converting types manually or editing generated files.

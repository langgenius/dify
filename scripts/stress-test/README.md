# Dify SSE stress tests

This Locust suite exercises streaming `POST /v1/workflows/run` requests against a local Dify instance with a mock OpenAI server. It measures connection counts, event throughput, time to first event (TTFE), stream duration, inter-event latency, and failures.

Run the following commands from the repository root. Keep long-running services in separate terminals.

## Prepare the runtime

Complete the [backend setup](../../api/README.md), including middleware, migrations, the plugin daemon, and workers. For measurements, run the API with Gunicorn instead of the development server:

```bash
uv run --project api gunicorn --chdir api \
  --bind 0.0.0.0:5001 --workers 4 --worker-class gevent \
  --timeout 120 --keep-alive 5 app:app
```

The worker count is a starting configuration; tune it for the machine and record it with the results.

Start the mock provider before running setup:

```bash
uv run --project api python scripts/stress-test/setup/mock_openai_server.py
```

Then provision the benchmark app, plugin configuration, and API key:

```bash
STRESS_TEST_ADMIN_EMAIL='your-admin@example.com' \
STRESS_TEST_ADMIN_USERNAME='dify' \
STRESS_TEST_ADMIN_PASSWORD='your-password' \
uv run --project api python scripts/stress-test/setup_all.py
```

Setup creates the first admin on an uninitialized instance or signs in with the supplied account on an existing instance. `STRESS_TEST_ADMIN_USERNAME` is used only for initial setup. It writes credentials and the app API key to `scripts/stress-test/setup/config/stress_test_state.json`; keep that local file private.

## Run

```bash
./scripts/stress-test/run_locust_stress_test.sh
```

The runner checks the API on port 5001, the mock provider on port 5004, and the saved API key. It prompts for headless mode or the Web UI at <http://localhost:8089>. Locust runs in its own environment through `uvx --from locust`.

For headless runs, the wrapper reads `users`, `spawn-rate`, and `run-time` from [`locust.conf`](locust.conf). To set options directly, invoke Locust from the repository root:

```bash
uvx --from locust locust -f scripts/stress-test/sse_benchmark.py \
  --host http://localhost:5001 --users 50 --spawn-rate 5 \
  --run-time 1m --headless
```

For the Web UI:

```bash
uvx --from locust locust -f scripts/stress-test/sse_benchmark.py \
  --host http://localhost:5001 --web-port 8089
```

The wrapper fixes the target to localhost; use the direct invocation to change the host. Direct invocations must set their own options or explicitly load `scripts/stress-test/locust.conf` with `--config`.

## Workload configuration

[`sse_benchmark.py`](sse_benchmark.py) reads these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKFLOW_PATH` | `/v1/workflows/run` | Request path |
| `CONNECT_TIMEOUT` | `10` | Connection timeout in seconds |
| `READ_TIMEOUT` | `60` | Stream read timeout in seconds |
| `TERMINAL_EVENTS` | `workflow_finished,error` | Comma-separated terminal event names |
| `QUESTIONS_FILE` | Empty | Text file with one nonempty question per line; otherwise uses built-in questions |
| `WAIT_TIME` | `0` | `0` sends the next request immediately; any other value selects a random 1–3 second wait |

Requests pass the selected question as `inputs.question`. Keep this aligned with the benchmark workflow. A custom question file avoids editing the benchmark source.

## Reports and interpretation

Headless wrapper runs create `scripts/stress-test/reports/YYYYMMDD_HHMMSS/` containing:

- `locust_summary.txt`: console output.
- `locust_report.html`: Locust report.
- `locust_stats.csv` and `locust_stats_history.csv`: request statistics.
- `sse_metrics_YYYYMMDD_HHMMSS.json`: custom SSE metrics.

Direct runs write custom SSE JSON under `scripts/stress-test/reports/`; request CSV or HTML explicitly with Locust options. Live SSE metrics update every five seconds.

Compare results with the same workflow, mock response behavior, hardware, worker configuration, and load profile. TTFE measures arrival of the first SSE event, not necessarily the first model token. Use the custom stream-duration metrics to assess stream completion separately from the standard Locust request timings. This mock-provider workload does not establish real-model latency or a universal production capacity threshold.

For failures, inspect API, worker, plugin-daemon, and mock-server logs. Check timeouts, CPU, memory, database connections, and client resource limits before changing concurrency or server settings.

## Maintenance

- Setup and fixture provisioning: `setup_all.py` and `setup/`.
- Load defaults: `locust.conf`.
- Stream parsing and metrics: `sse_benchmark.py`.
- Service checks and report collection: `run_locust_stress_test.sh`.

`cleanup.py` removes local setup state and reports, not the resources created in Dify. Preserve reports you need before running it; it asks for confirmation only in an interactive terminal.

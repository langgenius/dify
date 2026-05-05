# WSL/Docker Stability Notes for RAG Evaluation

Last updated: 2026-05-05

## Context

The RAG code path passed direct checks and service-level evaluation, but the local WSL/Docker environment has shown intermittent instability. Treat evaluation failures during these periods as infrastructure-suspect until the stack health is verified.

Observed symptoms:

- `pytest` started but produced no output until manually killed.
- `docker ps` / `docker compose logs` temporarily stopped responding.
- `redis` became `unhealthy`.
- `plugin_daemon` failed to resolve `redis` or `plugin_daemon`.
- Dify chat returned HTTP 400 with messages like:
  - `Failed to request plugin daemon`
  - `Request to Plugin Daemon Service failed-500`

After restarting `redis`, `plugin_daemon`, `api`, `worker`, and `worker_beat`, the same chat probe and evaluation recovered.

## Before Evaluation

Run from `/home/koishi/projects/codex_RAG/dify/docker`:

```bash
docker compose ps api worker worker_beat plugin_daemon redis ollama docproc nginx
./tools/preflight_eval.sh --fix
```

Expected minimum state:

- `redis` is `healthy`.
- `ollama` is `healthy`.
- `docproc` is `healthy`.
- `api`, `worker`, `worker_beat`, `plugin_daemon`, and `nginx` are running.
- `preflight` reports `docproc summary endpoint ok: qwen3.5-2b`.

Recommended manual chat probe if the environment was recently unstable:

```bash
python3 tools/probe_dify_chat.py --max-cases 1
```

If plugin daemon errors appear, restart the dependent services before trusting evaluation results:

```bash
docker compose restart redis plugin_daemon api worker worker_beat
./tools/preflight_eval.sh --fix
```

## Current Known Good Result

Latest stable report:

- `/home/koishi/projects/codex_RAG/dify/docker/eval/results/STABLE-NAV-INTEGRATED-FIX16_REPORT.md`
- `/home/koishi/projects/codex_RAG/dify/docker/eval/results/STABLE-NAV-INTEGRATED-FIX16-results.json`

Summary:

- Retrieval doc/page Top1: 100%
- Chat success: 100%
- Answer any/all keyword hit: 100%
- Chat reference doc/page hit: 100%
- Timeout: 0%


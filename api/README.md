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

1. Optional: start Celery Beat (scheduled tasks).

   ```bash
   ./dev/start-beat
   ```

### Environment notes

> [!IMPORTANT]
>
> When the frontend and backend run on different subdomains, set COOKIE_DOMAIN to the site’s top-level domain (e.g., `example.com`). The frontend and backend must be under the same top-level domain in order to share authentication cookies.

Leave `SECRET_KEY` empty to let Dify generate a persistent key in the storage directory. To manage it explicitly, generate a value with `openssl rand -base64 42` and set `SECRET_KEY` in `api/.env`.

## Testing

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

The checked-in Markdown reference lives in `api/openapi/markdown`. The generator's default output directories are anchored to `api/`, regardless of the working directory. Refresh it with:

```bash
uv run --project api python api/dev/generate_swagger_markdown_docs.py \
  --swagger-dir packages/contracts/openapi --markdown-dir api/openapi/markdown --keep-swagger-json
```

Update the backend schema owner and regenerate contracts instead of converting types manually or editing generated files.

# Dify Backend API

## Setup and Run

> [!IMPORTANT]
>
> In the v1.3.0 release, `poetry` has been replaced with
> [`uv`](https://docs.astral.sh/uv/) as the package manager
> for Dify API backend service.

`uv` and `pnpm` are required to run the setup and development commands below.

### Using scripts (recommended)

The scripts resolve paths relative to their location, so you can run them from anywhere.

1. Run setup (copies env files and installs dependencies).

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

1. Set up your application by visiting `http://localhost:3000`.

1. Optional: start the worker service (async tasks, runs from `api`).

   ```bash
   ./dev/start-worker
   ```

1. Optional: start Celery Beat (scheduled tasks).

   ```bash
   ./dev/start-beat
   ```

### Manual commands

<details>
<summary>Show manual setup and run steps</summary>

These commands assume you start from the repository root.

1. Start the docker-compose stack.

   The backend requires middleware, including PostgreSQL, Redis, and Weaviate, which can be started together using `docker-compose`.

   ```bash
   cp docker/middleware.env.example docker/middleware.env
   # Use mysql or another vector database profile if you are not using postgres/weaviate.
   docker compose -f docker/docker-compose.middleware.yaml --profile postgresql --profile weaviate -p dify up -d
   ```

1. Copy env files.

   ```bash
   cp api/.env.example api/.env
   cp web/.env.example web/.env.local
   ```

1. Install UV if needed.

   ```bash
   pip install uv
   # Or on macOS
   brew install uv
   ```

1. Install API dependencies.

   ```bash
   cd api
   uv sync --group dev
   ```

1. Install web dependencies.

   ```bash
   cd web
   pnpm install
   cd ..
   ```

1. Start backend (runs migrations first, in a new terminal).

   ```bash
   cd api
   uv run flask db upgrade
   uv run flask run --host 0.0.0.0 --port=5001 --debug
   ```

1. Start Dify [web](../web) service (in a new terminal).

   ```bash
   cd web
   pnpm dev:inspect
   ```

1. Set up your application by visiting `http://localhost:3000`.

1. Optional: start the worker service (async tasks, in a new terminal).

   ```bash
   cd api
   uv run celery -A app.celery worker -P threads -c 2 --loglevel INFO -Q dataset,priority_dataset,priority_pipeline,pipeline,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation,workflow,schedule_poller,schedule_executor,triggered_workflow_dispatcher,trigger_refresh_executor,retention
   ```

1. Optional: start Celery Beat (scheduled tasks, in a new terminal).

   ```bash
   cd api
   uv run celery -A app.celery beat
   ```

</details>

### Environment notes

> [!IMPORTANT]
>
> When the frontend and backend run on different subdomains, set COOKIE_DOMAIN to the site’s top-level domain (e.g., `example.com`). The frontend and backend must be under the same top-level domain in order to share authentication cookies.

- Generate a `SECRET_KEY` in the `.env` file.

  bash for Linux

  ```bash
  sed -i "/^SECRET_KEY=/c\\SECRET_KEY=$(openssl rand -base64 42)" .env
  ```

  bash for Mac

  ```bash
  secret_key=$(openssl rand -base64 42)
  sed -i '' "/^SECRET_KEY=/c\\
  SECRET_KEY=${secret_key}" .env
  ```

## Testing

1. Install dependencies for both the backend and the test environment

   ```bash
   cd api
   uv sync --group dev
   ```

1. Run the tests locally with mocked system environment variables in `tool.pytest_env` section in `pyproject.toml`, more can check [Claude.md](../CLAUDE.md)

   ```bash
   cd api
   uv run pytest                           # Run all tests
   uv run pytest tests/unit_tests/         # Unit tests only
   uv run pytest tests/integration_tests/  # Integration tests

   # Code quality
   ./dev/reformat               # Run all formatters and linters
   uv run ruff check --fix ./   # Fix linting issues
   uv run ruff format ./        # Format code
   uv run basedpyright .        # Type checking
   ```

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

1. Start the worker service (async and scheduler tasks, runs from `api`).

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

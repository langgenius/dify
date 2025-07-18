# Dify Backend API

## Usage

> [!IMPORTANT]
> 
> In the v1.3.0 release, `poetry` has been replaced with
> [`uv`](https://docs.astral.sh/uv/) as the package manager
> for Dify API backend service.

1. Start the docker-compose stack

   The backend require some middleware, including PostgreSQL, Redis, and Weaviate, which can be started together using `docker-compose`.

   ```bash
   cd ../docker
   cp middleware.env.example middleware.env
   # change the profile to other vector database if you are not using weaviate
   docker compose -f docker-compose.middleware.yaml --profile weaviate -p dify up -d
   cd ../api
   ```

2. Copy `.env.example` to `.env`

   ```cli
   cp .env.example .env 
   ```
3. Generate a `SECRET_KEY` in the `.env` file.

   bash for Linux
   ```bash for Linux
   sed -i "/^SECRET_KEY=/c\SECRET_KEY=$(openssl rand -base64 42)" .env
   ```
   bash for Mac
   ```bash for Mac
   secret_key=$(openssl rand -base64 42)
   sed -i '' "/^SECRET_KEY=/c\\
   SECRET_KEY=${secret_key}" .env
   ```

4. Create environment.

   Dify API service uses [UV](https://docs.astral.sh/uv/) to manage dependencies.
   First, you need to add the uv package manager, if you don't have it already.

   ```bash
   pip install uv
   # Or on macOS
   brew install uv
   ```

5. Install dependencies

   ```bash
   uv sync --dev
   ```

6. Run migrate

   Before the first launch, migrate the database to the latest version.

   ```bash
   uv run flask db upgrade
   ```

7. Start backend

   ```bash
   uv run flask run --host 0.0.0.0 --port=5001 --debug
   ```

8. Start Dify [web](../web) service.
9. Setup your application by visiting `http://localhost:3000`.
10. If you need to handle and debug the async tasks (e.g. dataset importing and documents indexing), please start the worker service.

   ```bash
   uv run celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail,ops_trace,app_deletion
   ```

## Testing

1. Install dependencies for both the backend and the test environment

   ```bash
   uv sync --dev
   ```

2. Run the tests locally with mocked system environment variables in `tool.pytest_env` section in `pyproject.toml`

   ```bash
   uv run -P api bash dev/pytest/pytest_all_tests.sh
   ```


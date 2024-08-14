# Dify Backend API

## Usage

> [!IMPORTANT]
> In the v0.6.12 release, we deprecated `pip` as the package management tool for Dify API Backend service and replaced it with `poetry`.

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
3. Generate a `SECRET_KEY` in the `.env` file.

   ```bash for Linux
   sed -i "/^SECRET_KEY=/c\SECRET_KEY=$(openssl rand -base64 42)" .env
   ```

   ```bash for Mac
   secret_key=$(openssl rand -base64 42)
   sed -i '' "/^SECRET_KEY=/c\\
   SECRET_KEY=${secret_key}" .env
   ```

4. Create environment.

   Dify API service uses [Poetry](https://python-poetry.org/docs/) to manage dependencies. You can execute `poetry shell` to activate the environment.

5. Install dependencies

   ```bash
   poetry env use 3.10
   poetry install
   ```

   In case of contributors missing to update dependencies for `pyproject.toml`, you can perform the following shell instead.

   ```bash
   poetry shell                                               # activate current environment
   poetry add $(cat requirements.txt)           # install dependencies of production and update pyproject.toml
   poetry add $(cat requirements-dev.txt) --group dev    # install dependencies of development and update pyproject.toml
   ```

6. Run migrate

   Before the first launch, migrate the database to the latest version.

   ```bash
   poetry run python -m flask db upgrade
   ```

7. Start backend

   ```bash
   poetry run python -m flask run --host 0.0.0.0 --port=5001 --debug
   ```

8. Start Dify [web](../web) service.
9. Setup your application by visiting `http://localhost:3000`...
10. If you need to debug local async processing, please start the worker service.

   ```bash
   poetry run python -m celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail,ops_trace,app_deletion
   ```

   The started celery app handles the async tasks, e.g. dataset importing and documents indexing.

## Testing

1. Install dependencies for both the backend and the test environment

   ```bash
   poetry install --with dev
   ```

2. Run the tests locally with mocked system environment variables in `tool.pytest_env` section in `pyproject.toml`

   ```bash
   cd ../
   poetry run -C api bash dev/pytest/pytest_all_tests.sh
   ```

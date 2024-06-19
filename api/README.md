# Dify Backend API

## Usage

1. Start the docker-compose stack

   The backend require some middleware, including PostgreSQL, Redis, and Weaviate, which can be started together using `docker-compose`.

   ```bash
   cd ../docker
   docker-compose -f docker-compose.middleware.yaml -p dify up -d
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

   > Using pip can be found [below](#usage-with-pip).

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
   poetry run python -m celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail
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

## Usage with pip

> [!NOTE]  
> In the next version, we will deprecate pip as the primary package management tool for dify api service, currently Poetry and pip coexist.

1. Start the docker-compose stack

   The backend require some middleware, including PostgreSQL, Redis, and Weaviate, which can be started together using `docker-compose`.

   ```bash
   cd ../docker
   docker-compose -f docker-compose.middleware.yaml -p dify up -d
   cd ../api
   ```

2. Copy `.env.example` to `.env`
3. Generate a `SECRET_KEY` in the `.env` file.

   ```bash
   sed -i "/^SECRET_KEY=/c\SECRET_KEY=$(openssl rand -base64 42)" .env
   ```

4. Create environment.

   If you use Anaconda, create a new environment and activate it
  
   ```bash
   conda create --name dify python=3.10
   conda activate dify
   ```

5. Install dependencies

   ```bash
   pip install -r requirements.txt
   ```

6. Run migrate

   Before the first launch, migrate the database to the latest version.

   ```bash
   flask db upgrade
   ```

7. Start backend:

   ```bash
   flask run --host 0.0.0.0 --port=5001 --debug
   ```

8. Setup your application by visiting <http://localhost:5001/console/api/setup> or other apis...
9. If you need to debug local async processing, please start the worker service.

   ```bash
   celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail
   ```

   The started celery app handles the async tasks, e.g. dataset importing and documents indexing.

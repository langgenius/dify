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

   ```bash
   sed -i "/^SECRET_KEY=/c\SECRET_KEY=$(openssl rand -base64 42)" .env
   ```
4. If you use Anaconda, create a new environment and activate it
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

   ⚠️ If you encounter problems with jieba, for example

   ```
   > flask db upgrade
   Error: While importing 'app', an ImportError was raised:
   ```

   Please run the following command instead.

   ```
   pip install -r requirements.txt --upgrade --force-reinstall
   ```

7. Start backend:
   ```bash
   flask run --host 0.0.0.0 --port=5001 --debug
   ```
8. Setup your application by visiting http://localhost:5001/console/api/setup or other apis...
9. If you need to debug local async processing, please start the worker service by running 
`celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail`.
The started celery app handles the async tasks, e.g. dataset importing and documents indexing.


## Testing

1. Install dependencies for both the backend and the test environment
   ```bash
   pip install -r requirements.txt -r requirements-dev.txt
   ``` 
   
2. Run the tests locally with mocked system environment variables in `tool.pytest_env` section in `pyproject.toml`
   ```bash
   dev/pytest/pytest_all_tests.sh
   ```

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
3.5 If you use annaconda, create a new environment and activate it
   ```bash
   conda create --name dify python=3.10
   conda activate dify
   ```
4. Install dependencies
   ```bash
   pip install -r requirements.txt
   ```
5. Run migrate

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

6. Start backend:
   ```bash
   flask run --host 0.0.0.0 --port=5001 --debug
   ```
7. Setup your application by visiting http://localhost:5001/console/api/setup or other apis...
8. If you need to debug local async processing, you can run `celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail`, celery can do dataset importing and other async tasks.

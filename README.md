# Commerce AI

This project is a fork of [Dify](https://github.com/langgenius/dify), an open-source platform for developing LLM applications. Dify offers an intuitive interface that integrates AI workflows, RAG pipelines, agent capabilities, model management, observability features, and more, enabling you to rapidly transition from prototype to production.

We are creating a platform for AI-powered commerce.

# Backend API

## Usage

1. Start the docker-compose stack

   The backend require some middleware, including PostgreSQL, Redis, and Weaviate, which can be started together using `docker-compose`.

   ```bash
   cd ../docker
   cp middleware.env.example middleware.env   
   docker compose -f docker-compose.middleware.yaml up -d
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

   API service uses [Poetry](https://python-poetry.org/docs/) to manage dependencies. You can execute `poetry shell` to activate the environment.

5. Install dependencies

   ```bash
   poetry env use 3.12
   poetry install
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

8. Start [web](../web) service.
9. Setup your application by visiting `http://localhost:3000`...
10. If you need to handle and debug the async tasks (e.g. dataset importing and documents indexing), please start the worker service.

   ```bash
   poetry run python -m celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail,ops_trace,app_deletion
   ```

## Testing

1. Install dependencies for both the backend and the test environment

   ```bash
   poetry install -C api --with dev
   ```

2. Run the tests locally with mocked system environment variables in `tool.pytest_env` section in `pyproject.toml`

   ```bash
   poetry run -C api bash dev/pytest/pytest_all_tests.sh
   ```


# Frontend

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

### Run by source code

To start the web frontend service, you will need [Node.js v18.x (LTS)](https://nodejs.org/en) and [NPM version 8.x.x](https://www.npmjs.com/) or [Yarn](https://yarnpkg.com/).

First, install the dependencies:

```bash
npm install
# or
yarn install --frozen-lockfile
```

Then, configure the environment variables. Create a file named `.env.local` in the current directory and copy the contents from `.env.example`. Modify the values of these environment variables according to your requirements:

```bash
cp .env.example .env.local
```

```
# For production release, change this to PRODUCTION
NEXT_PUBLIC_DEPLOY_ENV=DEVELOPMENT
# The deployment edition, SELF_HOSTED
NEXT_PUBLIC_EDITION=SELF_HOSTED
# The base URL of console application, refers to the Console base URL of WEB service if console domain is
# different from api or web app domain.
# example: http://cloud.dify.ai/console/api
NEXT_PUBLIC_API_PREFIX=http://localhost:5001/console/api
# The URL for Web APP, refers to the Web App base URL of WEB service if web app domain is different from
# console or api domain.
# example: http://udify.app/api
NEXT_PUBLIC_PUBLIC_API_PREFIX=http://localhost:5001/api

# SENTRY
NEXT_PUBLIC_SENTRY_DSN=
```

Finally, run the development server:

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the file under folder `app`. The page auto-updates as you edit the file.

## Deploy

### Deploy on server

First, build the app for production:

```bash
npm run build
```

Then, start the server:

```bash
npm run start
```

If you want to customize the host and port:

```bash
npm run start --port=3001 --host=0.0.0.0
```

## Storybook

This project uses [Storybook](https://storybook.js.org/) for UI component development.

To start the storybook server, run:

```bash
yarn storybook
```

Open [http://localhost:6006](http://localhost:6006) with your browser to see the result.

## Lint Code

If your IDE is VSCode, rename `web/.vscode/settings.example.json` to `web/.vscode/settings.json` for lint code setting.

## Test

We start to use [Jest](https://jestjs.io/) and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) for Unit Testing.

You can create a test file with a suffix of `.spec` beside the file that to be tested. For example, if you want to test a file named `util.ts`. The test file name should be `util.spec.ts`.

Run test:

```bash
npm run test
```

If you are not familiar with writing tests, here is some code to refer to:
* [classnames.spec.ts](./utils/classnames.spec.ts)
* [index.spec.tsx](./app/components/base/button/index.spec.tsx)



## Documentation

Visit <https://docs.dify.ai/getting-started/readme> to view the full documentation.


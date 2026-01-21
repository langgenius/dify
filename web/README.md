# Dify Frontend

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

### Run by source code

Before starting the web frontend service, please make sure the following environment is ready.

- [Node.js](https://nodejs.org)
- [pnpm](https://pnpm.io)

> [!TIP]
> It is recommended to install and enable Corepack to manage package manager versions automatically:
>
> ```bash
> npm install -g corepack
> corepack enable
> ```
>
> Learn more: [Corepack](https://github.com/nodejs/corepack#readme)

First, install the dependencies:

```bash
pnpm install
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
NEXT_PUBLIC_COOKIE_DOMAIN=
# The URL for Web APP, refers to the Web App base URL of WEB service if web app domain is different from
# console or api domain.
# example: http://udify.app/api
NEXT_PUBLIC_PUBLIC_API_PREFIX=http://localhost:5001/api

# SENTRY
NEXT_PUBLIC_SENTRY_DSN=
```

> [!IMPORTANT]
>
> 1. When the frontend and backend run on different subdomains, set NEXT_PUBLIC_COOKIE_DOMAIN=1. The frontend and backend must be under the same top-level domain in order to share authentication cookies.
> 1. It's necessary to set NEXT_PUBLIC_API_PREFIX and NEXT_PUBLIC_PUBLIC_API_PREFIX to the correct backend API URL.

Finally, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the file under folder `app`. The page auto-updates as you edit the file.

## Deploy

### Deploy on server

First, build the app for production:

```bash
pnpm run build
```

Then, start the server:

```bash
pnpm run start
```

If you want to customize the host and port:

```bash
pnpm run start --port=3001 --host=0.0.0.0
```

If you want to customize the number of instances launched by PM2, you can configure `PM2_INSTANCES` in `docker-compose.yaml` or `Dockerfile`.

## Storybook

This project uses [Storybook](https://storybook.js.org/) for UI component development.

To start the storybook server, run:

```bash
pnpm storybook
```

Open [http://localhost:6006](http://localhost:6006) with your browser to see the result.

## Lint Code

If your IDE is VSCode, rename `web/.vscode/settings.example.json` to `web/.vscode/settings.json` for lint code setting.

## Test

We use [Vitest](https://vitest.dev/) and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) for Unit Testing.

**📖 Complete Testing Guide**: See [web/testing/testing.md](./testing/testing.md) for detailed testing specifications, best practices, and examples.

Run test:

```bash
pnpm test
```

### Example Code

If you are not familiar with writing tests, refer to:

- [classnames.spec.ts](./utils/classnames.spec.ts) - Utility function test example
- [index.spec.tsx](./app/components/base/button/index.spec.tsx) - Component test example

### Analyze Component Complexity

Before writing tests, use the script to analyze component complexity:

```bash
pnpm analyze-component app/components/your-component/index.tsx
```

This will help you determine the testing strategy. See [web/testing/testing.md](./testing/testing.md) for details.

## Documentation

Visit <https://docs.dify.ai> to view the full documentation.

## Community

The Dify community can be found on [Discord community](https://discord.gg/5AEfbxcd9k), where you can ask questions, voice ideas, and share your projects.

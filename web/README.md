# Dify Frontend

This is a [Next.js] application with [vinext] as the default local development server.

## Getting Started

### Run by source code

The required Node.js and pnpm versions are pinned by the repository root `.nvmrc` and `packageManager` field. [Vite+] is also available for repository checks and tests; use its official documentation as the installation reference.

- [Node.js]
- [pnpm]

Run the following commands from the repository root.

First, install the dependencies:

```bash
pnpm install
```

> [!NOTE]
> JavaScript dependencies are managed by the workspace files at the repository root: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `.nvmrc`.
> Install dependencies and run the commands below from the repository root.

Then, configure the environment variables.
Create `web/.env.local` and copy the contents from `web/.env.example`.
Modify the values of these environment variables according to your requirements:

```bash
cp web/.env.example web/.env.local
```

> [!IMPORTANT]
>
> 1. When the frontend and backend run on different subdomains, set NEXT_PUBLIC_COOKIE_DOMAIN=1. The frontend and backend must be under the same top-level domain in order to share authentication cookies.
> 1. It's necessary to set NEXT_PUBLIC_API_PREFIX and NEXT_PUBLIC_PUBLIC_API_PREFIX to the correct backend API URL.

Finally, start the default development stack from the repository root. This runs vinext and the local API proxy together:

```bash
pnpm dev
```

Use `pnpm -C web dev` only when you specifically need the Next.js development server without the default vinext process. Proxy environment variables are documented in `web/.env.example`; route ownership remains in `web/dev-proxy.config.ts`.

Open <http://localhost:3000> with your browser to see the result.

You can start editing the files under `web/app`.
The page auto-updates as you edit the file.

## Deploy

### Deploy on server

First, build the app for production:

```bash
pnpm -C web run build
```

Then, start the server:

```bash
pnpm -C web run start
```

If you build the Docker image manually, use the repository root as the build context:

```bash
docker build -f web/Dockerfile -t dify-web .
```

If you want to customize the host and port:

```bash
pnpm -C web run start --port=3001 --host=0.0.0.0
```

## Storybook

This project uses [Storybook] for UI component development.

To start the storybook server, run:

```bash
pnpm -C web storybook
```

Open <http://localhost:6006> with your browser to see the result.

## Lint Code

If your IDE is VSCode, rename `.vscode/settings.example.json` to `.vscode/settings.json` for lint code setting.

Then follow the [Lint Documentation] to lint the code.

## Test

We use [Vitest] and [React Testing Library] for Unit Testing.

**📖 Frontend Testing Guide**: See the [Frontend Testing Guide] for the canonical testing policy and workflow.

> [!IMPORTANT]
> As we are using Vite+, the `vitest` command is not available.
> Please make sure to run tests with `vp` commands.
> For example, use `vp test` instead of `vitest`.

Run test:

```bash
cd web
vp test run --project unit
```

The standard unit command runs in `happy-dom`. Browser Mode is reserved for behavior that depends on a real browser; see the [Frontend Testing Guide] for its admission criteria and commands. Always select a project explicitly: bare `vp test` runs every registered project, including Browser Mode.

If a test fails only in CI, inspect the failing job and reproduce it locally when possible. A rerun can help identify a flaky test, but it does not replace diagnosing or reporting the failure.

## Documentation

Visit <https://docs.dify.ai> to view the full documentation.

## Community

The Dify community can be found on [Discord community], where you can ask questions, voice ideas, and share your projects.

[Discord community]: https://discord.gg/5AEfbxcd9k
[Frontend Testing Guide]: ./docs/test.md
[Lint Documentation]: ./docs/lint.md
[Next.js]: https://nextjs.org
[Node.js]: https://nodejs.org
[React Testing Library]: https://testing-library.com/docs/react-testing-library/intro
[Storybook]: https://storybook.js.org
[Vite+]: https://viteplus.dev
[Vitest]: https://vitest.dev
[pnpm]: https://pnpm.io
[vinext]: https://github.com/cloudflare/vinext

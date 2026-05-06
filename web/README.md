# Dify Frontend

This is a [Next.js] project, but you can dev with [vinext].

## Getting Started

### Run by source code

Before starting the web frontend service, please make sure the following environment is ready.

- [Node.js]
- [pnpm]

You can also use [Vite+] with the corresponding `vp` commands.
For example, use `vp install` instead of `pnpm install` and `vp test` instead of `pnpm run test`.

> [!TIP]
> It is recommended to install and enable Corepack to manage package manager versions automatically:
>
> ```bash
> npm install -g corepack
> corepack enable
> ```
>
> Learn more: [Corepack]

Run the following commands from the repository root.

First, install the dependencies:

```bash
pnpm install
```

> [!NOTE]
> JavaScript dependencies are managed by the workspace files at the repository root: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `.nvmrc`.
> Install dependencies from the repository root, then run frontend scripts from `web/`.

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

Finally, run the development server:

```bash
pnpm -C web run dev
# or if you are using vinext which provides a better development experience
pnpm -C web run dev:vinext
# (optional) start the dev proxy server so that you can use online API in development
pnpm -C web run dev:proxy
# (optional) start the dev proxy for the Enterprise frontend; it listens on 8082 by default
pnpm -C web run dev:proxy -- --target enterprise
```

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

**📖 Complete Testing Guide**: See [web/docs/test.md] for detailed testing specifications, best practices, and examples.

> [!IMPORTANT]
> As we are using Vite+, the `vitest` command is not available.
> Please make sure to run tests with `vp` commands.
> For example, use `npx vp test` instead of `npx vitest`.

Run test:

```bash
pnpm -C web test
```

> [!NOTE]
> Our test is not fully stable yet, and we are actively working on improving it.
> If you encounter test failures only in CI but not locally, please feel free to ignore them and report the issue to us.
> You can try to re-run the test in CI, and it may pass successfully.

### Example Code

If you are not familiar with writing tests, refer to:

- [index.spec.tsx] - Component test example

### Analyze Component Complexity

Before writing tests, use the script to analyze component complexity:

```bash
pnpm analyze-component app/components/your-component/index.tsx
```

This will help you determine the testing strategy. See [web/testing/testing.md] for details.

## Documentation

Visit <https://docs.dify.ai> to view the full documentation.

## Community

The Dify community can be found on [Discord community], where you can ask questions, voice ideas, and share your projects.

[Corepack]: https://github.com/nodejs/corepack#readme
[Discord community]: https://discord.gg/5AEfbxcd9k
[Lint Documentation]: ./docs/lint.md
[Next.js]: https://nextjs.org
[Node.js]: https://nodejs.org
[React Testing Library]: https://testing-library.com/docs/react-testing-library/intro
[Storybook]: https://storybook.js.org
[Vite+]: https://viteplus.dev
[Vitest]: https://vitest.dev
[index.spec.tsx]: ./app/components/base/radio/__tests__/index.spec.tsx
[pnpm]: https://pnpm.io
[vinext]: https://github.com/cloudflare/vinext
[web/docs/test.md]: ./docs/test.md

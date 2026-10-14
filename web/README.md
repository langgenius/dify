# Dify Frontend

This is a [Next.js] application with [vinext] as the default local development server.

## Getting Started

### Run by source code

The required Node.js and pnpm versions are pinned by the repository root `devEngines.runtime` and `packageManager` fields. [Vite+] is also available for repository checks and tests; use its official documentation as the installation reference.

- [Node.js]
- [pnpm]

Run the following commands from the repository root.

First, install the dependencies:

```bash
pnpm install
```

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

### Vinext toolchain

The workspace catalog pins vinext to `1.0.0-beta.13`. Following the
[versioned vinext guide], `dev:vinext` and `build:vinext` use the project-local
Vite+ CLI (`vp dev` / `vp build`); the vinext plugin owns the development and multi-environment build
lifecycle. Keep the Next.js scripts available for compatibility comparisons.

When upgrading, run the installed compatibility scanner and verify the application:

```bash
pnpm -C web exec vinext check
pnpm -C web run build:vinext
pnpm -C web run start:vinext
```

The scanner is a starting point; also check sign-in, redirects, and the workflows
affected by the upgrade. See the [vinext migration guide] for validation guidance.

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
PORT=3001 HOSTNAME=0.0.0.0 pnpm -C web run start
```

### Vinext standalone Node server

`pnpm -C web run build:vinext` honors `output: 'standalone'` in `next.config.ts`
and emits `web/dist/standalone`. To run the self-contained production server:

```bash
HOST=0.0.0.0 PORT=3000 node web/dist/standalone/server.js
```

Vinext uses `HOST` for the bind address; Next.js standalone uses `HOSTNAME`.
Use `start:vinext` for local production testing. See [vinext Node deployment].

## Storybook

This project uses [Storybook] for UI component development.

To start the storybook server, run:

```bash
pnpm -C web storybook
```

Open <http://localhost:6006> with your browser to see the result.

## Lint Code

For VS Code, copy `.vscode/settings.example.json` to `.vscode/settings.json`, or merge it into your existing settings.

Then follow the [Lint Documentation] to lint the code.

## Test

We use [Vitest] and [React Testing Library] through Vite+. Run unit tests in `happy-dom` with:

```bash
cd web
vp test run --project unit
```

Select a project explicitly; bare `vp test` also runs Browser Mode. Use `vp` instead of the standalone `vitest` command. The [Frontend Testing Guide] owns test policy, Browser Mode admission, and diagnostic commands.

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
[versioned vinext guide]: https://github.com/cloudflare/vinext/blob/vinext%401.0.0-beta.13/README.md
[vinext Node deployment]: https://vinext.dev/docs/deploying/other-platforms
[vinext migration guide]: https://vinext.dev/docs/getting-started/migrating
[vinext]: https://github.com/cloudflare/vinext

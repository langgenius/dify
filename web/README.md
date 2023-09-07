# Dify Frontend
This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started
### Run by source code
To start the web frontend service, you will need [Node.js v18.x (LTS)](https://nodejs.org/en) and [NPM version 8.x.x](https://www.npmjs.com/) or [Yarn](https://yarnpkg.com/).

First, install the dependencies:

```bash
npm install
# or
yarn
```

Then, configure the environment variables. Create a file named `.env.local` in the current directory and copy the contents from `.env.example`. Modify the values of these environment variables according to your requirements:
```
# For production release, change this to PRODUCTION
NEXT_PUBLIC_DEPLOY_ENV=DEVELOPMENT
# The deployment edition, SELF_HOSTED or CLOUD
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

### Run by Docker
First, Build the frontend image：
```bash
docker build . -t dify-web
```

Then, configure the environment variables.Use the same method mentioned in run by source code.

Finally, run the frontend service:
```bash
docker run -it -p 3000:3000 -e EDITION=SELF_HOSTED -e CONSOLE_URL=http://127.0.0.1:3000 -e APP_URL=http://127.0.0.1:3000 dify-web
```

When the console api domain and web app api domain are different, you can set the CONSOLE_URL and APP_URL separately.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deploy
### Deploy on server
First, build the app for production:

```bash
npm run build
```

Then, move the static files to standalone folder:
```bash
mv .next/static .next/standalone/.next
cp -r ./public .next/standalone/.next/
```

Finally, start the app:
```bash
node .next/standalone/server.js 
```

If your project needs alternative port or hostname for listening, you can define PORT and HOSTNAME environment variables, before running server.js. For example, `PORT=3000 HOSTNAME=localhost node .next/standalone/server.js`.

## Lint Code
If your IDE is VSCode, rename `web/.vscode/settings.example.json` to `web/.vscode/settings.json` for lint code setting.

## Documentation
Visit https://docs.dify.ai/getting-started/readme to view the full documentation.

## Community
The Dify community can be found on [Discord community](https://discord.com/invite/FngNHpbcY7), where you can ask questions, voice ideas, and share your projects.

import type { ServerType } from '@hono/node-server'
import type { DevProxyCliOptions, DevProxyConfig } from './types'
import process from 'node:process'
import { serve } from '@hono/node-server'
import { watch } from 'chokidar'
import {
  assertDevProxyConfig,
  loadDevProxyConfig,
  parseDevProxyCliArgs,
  resolveDevProxyServerOptions,
  watchDevProxyConfig,
} from './config'
import { createDevProxyApp } from './server'

function printUsage() {
  console.log(`Usage:
  dev-proxy --config <path> [options]

Options:
  --config, -c <path>  Path to a dev proxy config file. Defaults to dev-proxy.config.ts.
  --env-file <path>    Load environment variables before evaluating the config file.
  --host <host>        Override the configured host.
  --port <port>        Override the configured port.
  --watch              Reload config and env file changes. Enabled by default.
  --no-watch           Disable config and env file reloads.
  --help, -h           Show this help message.`)
}

async function flushStandardStreams() {
  await Promise.all([
    new Promise<void>((resolve) => process.stdout.write('', () => resolve())),
    new Promise<void>((resolve) => process.stderr.write('', () => resolve())),
  ])
}

const closeServer = (server: ServerType) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

const startDevProxyServer = (config: DevProxyConfig, cliOptions: DevProxyCliOptions) => {
  let app = createDevProxyApp(config)
  const { host, port } = resolveDevProxyServerOptions(config.server, cliOptions)
  const server = serve({
    fetch: (request, env) => app.fetch(request, env),
    hostname: host,
    port,
  })

  return {
    host,
    port,
    server,
    updateConfig(nextConfig: DevProxyConfig) {
      app = createDevProxyApp(nextConfig)
    },
  }
}

const createDevProxyRuntime = (initialConfig: DevProxyConfig, cliOptions: DevProxyCliOptions) => {
  let runtime = startDevProxyServer(initialConfig, cliOptions)
  let reloadTask = Promise.resolve()

  console.log(`[dev-proxy] listening on http://${runtime.host}:${runtime.port}`)

  const reload = async (nextConfig: unknown, reason: string) => {
    assertDevProxyConfig(nextConfig)
    const nextServerOptions = resolveDevProxyServerOptions(nextConfig.server, cliOptions)

    if (runtime.host === nextServerOptions.host && runtime.port === nextServerOptions.port) {
      runtime.updateConfig(nextConfig)
      console.log(`[dev-proxy] reloaded ${reason}`)
      return
    }

    await closeServer(runtime.server)
    runtime = startDevProxyServer(nextConfig, cliOptions)
    console.log(`[dev-proxy] restarted on http://${runtime.host}:${runtime.port} after ${reason}`)
  }

  const enqueueReload = (loadConfig: () => Promise<unknown> | unknown, reason: string) => {
    reloadTask = reloadTask.then(async () => {
      try {
        await reload(await loadConfig(), reason)
      } catch (error) {
        console.error(`[dev-proxy] failed to reload ${reason}`)
        console.error(error instanceof Error ? error.message : error)
      }
    })

    return reloadTask
  }

  return {
    enqueueReload,
    close: async () => {
      await reloadTask
      await closeServer(runtime.server)
    },
  }
}

async function main() {
  const cliOptions = parseDevProxyCliArgs(process.argv.slice(2))

  if (cliOptions.help) {
    printUsage()
    return
  }

  const config = await loadDevProxyConfig(cliOptions.config, process.cwd(), {
    envFile: cliOptions.envFile,
  })
  const runtime = createDevProxyRuntime(config, cliOptions)

  if (cliOptions.watch === false) return

  const configWatcher = await watchDevProxyConfig(cliOptions.config, process.cwd(), {
    envFile: cliOptions.envFile,
    onUpdate: ({ newConfig }) => runtime.enqueueReload(() => newConfig.config, 'config changes'),
  })

  const envWatcher = cliOptions.envFile
    ? watch(cliOptions.envFile, {
        cwd: process.cwd(),
        ignoreInitial: true,
      })
    : undefined

  envWatcher?.on('all', () => {
    void runtime.enqueueReload(
      () =>
        loadDevProxyConfig(cliOptions.config, process.cwd(), {
          envFile: cliOptions.envFile,
        }),
      'env file changes',
    )
  })

  const cleanup = async () => {
    await envWatcher?.close()
    await configWatcher.unwatch()
    await runtime.close()
  }

  process.once('SIGINT', () => {
    void cleanup().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void cleanup().finally(() => process.exit(0))
  })
}

try {
  await main()
  await flushStandardStreams()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await flushStandardStreams()
  process.exit(1)
}

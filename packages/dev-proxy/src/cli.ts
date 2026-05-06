import process from 'node:process'
import { serve } from '@hono/node-server'
import { loadDevProxyConfig, parseDevProxyCliArgs, resolveDevProxyServerOptions } from './config'
import { createDevProxyApp } from './server'

function printUsage() {
  console.log(`Usage:
  dev-proxy --config <path> [options]

Options:
  --config, -c <path>  Path to a dev proxy config file. Defaults to dev-proxy.config.ts.
  --env-file <path>    Load environment variables before evaluating the config file.
  --host <host>        Override the configured host.
  --port <port>        Override the configured port.
  --help, -h           Show this help message.`)
}

async function flushStandardStreams() {
  await Promise.all([
    new Promise<void>(resolve => process.stdout.write('', () => resolve())),
    new Promise<void>(resolve => process.stderr.write('', () => resolve())),
  ])
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
  const { host, port } = resolveDevProxyServerOptions(config.server, cliOptions)
  const app = createDevProxyApp(config)

  serve({
    fetch: app.fetch,
    hostname: host,
    port,
  })

  console.log(`[dev-proxy] listening on http://${host}:${port}`)
}

try {
  await main()
  await flushStandardStreams()
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await flushStandardStreams()
  process.exit(1)
}

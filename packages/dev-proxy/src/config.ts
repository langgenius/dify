import type { DotenvOptions } from 'c12'
import type { DevProxyCliOptions, DevProxyConfig, DevProxyConfigLoadOptions, DevProxyServerConfig, ResolvedDevProxyServerOptions } from './types'
import path from 'node:path'
import { loadConfig } from 'c12'

const DEFAULT_CONFIG_FILE = 'dev-proxy.config.ts'
const DEFAULT_PROXY_HOST = '127.0.0.1'
const DEFAULT_PROXY_PORT = 5001

const OPTION_NAME_TO_KEY = {
  '--config': 'config',
  '-c': 'config',
  '--env-file': 'envFile',
  '--host': 'host',
  '--port': 'port',
} as const

type OptionName = keyof typeof OPTION_NAME_TO_KEY

const isOptionName = (value: string): value is OptionName => value in OPTION_NAME_TO_KEY

const requireOptionValue = (name: string, value?: string) => {
  if (!value || value.startsWith('-'))
    throw new Error(`Missing value for ${name}.`)

  return value
}

export const parseDevProxyCliArgs = (argv: readonly string[]): DevProxyCliOptions => {
  const options: DevProxyCliOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!

    if (arg === '--')
      continue

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    const [rawName, inlineValue] = arg.split('=', 2)
    const name = rawName ?? ''

    if (!name.startsWith('-'))
      continue

    if (!isOptionName(name))
      throw new Error(`Unsupported dev proxy option "${name}".`)

    const key = OPTION_NAME_TO_KEY[name]
    options[key] = inlineValue ?? requireOptionValue(name, argv[index + 1])

    if (inlineValue === undefined)
      index += 1
  }

  return options
}

const resolvePort = (rawPort: string | number) => {
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid proxy port "${rawPort}". Expected an integer between 1 and 65535.`)

  return port
}

export const resolveDevProxyServerOptions = (
  serverConfig: DevProxyServerConfig = {},
  cliOptions: DevProxyCliOptions = {},
): ResolvedDevProxyServerOptions => {
  const configuredPort = cliOptions.port ?? serverConfig.port ?? DEFAULT_PROXY_PORT

  return {
    host: cliOptions.host || serverConfig.host || DEFAULT_PROXY_HOST,
    port: resolvePort(configuredPort),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function assertDevProxyConfig(config: unknown): asserts config is DevProxyConfig {
  if (!isRecord(config))
    throw new Error('Dev proxy config must export an object.')

  if (!Array.isArray(config.routes))
    throw new Error('Dev proxy config must include a routes array.')
}

const resolveDotenvOptions = (
  envFile: DevProxyConfigLoadOptions['envFile'],
  cwd: string,
): DotenvOptions | false => {
  if (!envFile)
    return false

  const resolvedEnvFilePath = path.resolve(cwd, envFile)
  return {
    cwd: path.dirname(resolvedEnvFilePath),
    fileName: path.basename(resolvedEnvFilePath),
    interpolate: true,
  }
}

export const loadDevProxyConfig = async (
  configPath = DEFAULT_CONFIG_FILE,
  cwd = process.cwd(),
  options: DevProxyConfigLoadOptions = {},
): Promise<DevProxyConfig> => {
  const resolvedConfigPath = path.resolve(cwd, configPath)
  const parsedPath = path.parse(resolvedConfigPath)
  const { config: loadedConfig } = await loadConfig({
    configFile: parsedPath.name,
    cwd: parsedPath.dir,
    dotenv: resolveDotenvOptions(options.envFile, cwd),
    envName: false,
    globalRc: false,
    packageJson: false,
    rcFile: false,
  })

  assertDevProxyConfig(loadedConfig)
  return loadedConfig
}

export const defineDevProxyConfig = (config: DevProxyConfig) => config

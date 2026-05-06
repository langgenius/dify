const DEV_PROXY_TARGETS = ['dify', 'enterprise'] as const

type DevProxyTarget = typeof DEV_PROXY_TARGETS[number]

type DevProxyConfigEnv = Partial<Record<
  | 'HONO_PROXY_HOST'
  | 'HONO_PROXY_PORT'
  | 'HONO_PROXY_TARGET',
  string
>>

type DevProxyCliOptions = {
  host?: string
  port?: string
  proxyTarget?: string
}

type DevProxyServerOptions = {
  host: string
  port: number
  proxyTarget: DevProxyTarget
}

const DEFAULT_PROXY_HOST = '127.0.0.1'
const DEFAULT_PROXY_TARGET: DevProxyTarget = 'dify'
const DEFAULT_PROXY_PORT_BY_TARGET: Record<DevProxyTarget, number> = {
  dify: 5001,
  enterprise: 8082,
}

const OPTION_NAME_TO_KEY = {
  '--host': 'host',
  '--port': 'port',
  '--proxy-target': 'proxyTarget',
  '--target': 'proxyTarget',
} as const

type OptionName = keyof typeof OPTION_NAME_TO_KEY

const isOptionName = (value: string): value is OptionName => value in OPTION_NAME_TO_KEY

const requireOptionValue = (name: string, value?: string) => {
  if (!value || isOptionName(value))
    throw new Error(`Missing value for ${name}.`)

  return value
}

export const parseDevProxyCliArgs = (argv: string[]): DevProxyCliOptions => {
  const options: DevProxyCliOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const [rawName, inlineValue] = arg.split('=', 2)
    const name = rawName ?? ''

    if (!isOptionName(name))
      continue

    const key = OPTION_NAME_TO_KEY[name]
    options[key] = inlineValue ?? requireOptionValue(name, argv[index + 1])

    if (inlineValue === undefined)
      index += 1
  }

  return options
}

export const resolveDevProxyTarget = (target?: string): DevProxyTarget => {
  if (!target)
    return DEFAULT_PROXY_TARGET

  const normalizedTarget = target.trim().toLowerCase()
  if (DEV_PROXY_TARGETS.includes(normalizedTarget as DevProxyTarget))
    return normalizedTarget as DevProxyTarget

  throw new Error(`Unsupported proxy target "${target}". Expected "dify" or "enterprise".`)
}

const resolvePort = (rawPort: string) => {
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid proxy port "${rawPort}". Expected an integer between 1 and 65535.`)

  return port
}

export const resolveDevProxyServerOptions = (
  env: DevProxyConfigEnv = {},
  cliOptions: DevProxyCliOptions = {},
): DevProxyServerOptions => {
  const proxyTarget = resolveDevProxyTarget(cliOptions.proxyTarget || env.HONO_PROXY_TARGET)
  const configuredPort = cliOptions.port || env.HONO_PROXY_PORT

  return {
    host: cliOptions.host || env.HONO_PROXY_HOST || DEFAULT_PROXY_HOST,
    port: configuredPort
      ? resolvePort(configuredPort)
      : DEFAULT_PROXY_PORT_BY_TARGET[proxyTarget],
    proxyTarget,
  }
}

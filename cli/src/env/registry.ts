import { parseLimit } from '../limit/limit.js'

export type EnvVar = {
  readonly name: string
  readonly description: string
  readonly default?: string
  readonly sensitive?: boolean
  readonly parse?: (raw: string) => unknown
}

const REGISTRY_UNSORTED: readonly EnvVar[] = [
  {
    name: 'DIFY_CONFIG_DIR',
    description: 'Override the config-dir resolution (precedes XDG_CONFIG_HOME on Linux).',
  },
  {
    name: 'DIFY_FORMAT',
    description: 'Default output format for list commands (table | json | yaml | wide | name).',
  },
  {
    name: 'DIFY_HOST',
    description: 'Default Dify host (overridden by --host).',
  },
  {
    name: 'DIFY_LIMIT',
    description: 'Default page size for list commands (1..200).',
    parse: (raw: string) => parseLimit(raw, 'DIFY_LIMIT'),
  },
  {
    name: 'DIFY_NO_PROGRESS',
    description: 'Suppress progress spinners. Truthy values: 1, true, yes.',
  },
  {
    name: 'DIFY_PLAIN',
    description: 'Disable ANSI colors and decorative output. Truthy values: 1, true, yes.',
  },
  {
    name: 'DIFY_TOKEN',
    description: 'Bearer token for non-interactive auth.',
    sensitive: true,
  },
  {
    name: 'DIFY_WORKSPACE_ID',
    description: 'Workspace ID used when no --workspace flag is set.',
  },
]

export const ENV_REGISTRY: readonly EnvVar[] = [...REGISTRY_UNSORTED].sort((a, b) =>
  a.name.localeCompare(b.name),
)

const BY_NAME = new Map(ENV_REGISTRY.map(e => [e.name, e]))

export function lookupEnv(name: string): EnvVar | undefined {
  return BY_NAME.get(name)
}

export function getEnv(name: string): string | undefined {
  return process.env[name]
}

export function resolveEnv(name: string): unknown {
  const entry = lookupEnv(name)
  const raw = getEnv(name) ?? entry?.default
  if (raw === undefined)
    return undefined
  return entry?.parse ? entry.parse(raw) : raw
}

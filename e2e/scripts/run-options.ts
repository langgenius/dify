import type { SeedOptions } from './seed-runner'

export type RunOptions = {
  forwardArgs: string[]
  full: boolean
  headed: boolean
  seed?: SeedOptions
  seedOnly: boolean
}

const readOptionValue = (argv: string[], index: number, option: string) => {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`)

  return value
}

export const parseRunOptions = (argv: string[]): RunOptions => {
  let allowBlocked = false
  let dryRun = false
  let full = false
  let headed = false
  let pack = 'agent-v2'
  let profile: string | undefined
  let seedOnly = false
  const forwardArgs: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!

    if (arg === '--') {
      forwardArgs.push(...argv.slice(index + 1))
      break
    }

    if (arg === '--full') {
      full = true
      continue
    }

    if (arg === '--headed') {
      headed = true
      continue
    }

    if (arg === '--seed-only') {
      seedOnly = true
      continue
    }

    if (arg === '--allow-blocked') {
      allowBlocked = true
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--pack') {
      pack = readOptionValue(argv, index, '--pack')
      index += 1
      continue
    }

    if (arg.startsWith('--pack=')) {
      pack = arg.slice('--pack='.length)
      if (!pack) throw new Error('--pack requires a value.')
      continue
    }

    if (arg === '--profile') {
      profile = readOptionValue(argv, index, '--profile')
      index += 1
      continue
    }

    if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
      if (!profile) throw new Error('--profile requires a value.')
      continue
    }

    forwardArgs.push(arg)
  }

  const shouldSeed = seedOnly || profile !== undefined
  if (!shouldSeed && (allowBlocked || dryRun || pack !== 'agent-v2'))
    throw new Error('Seed options require --seed-only or --profile.')
  if (dryRun && !seedOnly) throw new Error('--dry-run requires --seed-only.')

  return {
    forwardArgs,
    full,
    headed,
    seed: shouldSeed
      ? {
          allowBlocked,
          dryRun,
          pack,
          profile: profile ?? 'post-merge',
        }
      : undefined,
    seedOnly,
  }
}

const isTruthyEnv = (value: string | undefined) => value === '1' || value === 'true'

export const shouldStartManagedAgentBackend = (env: NodeJS.ProcessEnv = process.env) => {
  const shouldStart = isTruthyEnv(env.E2E_START_AGENT_BACKEND)
  const externalUrl = env.E2E_AGENT_BACKEND_URL?.trim() || env.AGENT_BACKEND_BASE_URL?.trim()

  if (shouldStart && externalUrl) {
    throw new Error(
      'E2E_START_AGENT_BACKEND cannot be enabled when E2E_AGENT_BACKEND_URL or AGENT_BACKEND_BASE_URL is set.',
    )
  }

  return shouldStart
}

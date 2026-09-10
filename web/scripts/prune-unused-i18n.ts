import type {
  AnalyzeUnusedTranslationsResult,
  RemoveUnusedTranslationsResult,
} from './i18n-prune/core'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { analyzeUnusedTranslations, removeUnusedTranslations } from './i18n-prune/core'

type CliArgs = {
  write: boolean
  json: boolean
  help: boolean
  files: string[]
  locales: string[]
  errors: string[]
}

function collectValues(argv: string[], startIndex: number) {
  const values: string[] = []
  let cursor = startIndex + 1
  while (cursor < argv.length && !argv[cursor]!.startsWith('--')) {
    values.push(argv[cursor]!)
    cursor++
  }
  return { values, nextIndex: cursor - 1 }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    write: false,
    json: false,
    help: false,
    files: [],
    locales: [],
    errors: [],
  }

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === '--write') {
      args.write = true
      continue
    }
    if (arg === '--json') {
      args.json = true
      continue
    }
    if (arg === '-h' || arg === '--help') {
      args.help = true
      continue
    }
    if (arg === '--file') {
      const { values, nextIndex } = collectValues(argv, index)
      if (!values.length) args.errors.push('--file requires at least one value')
      args.files.push(...values)
      index = nextIndex
      continue
    }
    if (arg === '--lang') {
      const { values, nextIndex } = collectValues(argv, index)
      if (!values.length) args.errors.push('--lang requires at least one value')
      args.locales.push(...values)
      index = nextIndex
      continue
    }
    args.errors.push(`Unknown argument: ${arg}`)
  }

  return args
}

function printHelp() {
  console.log(`Usage: pnpm run i18n:prune-unused [options]

Options:
  --write           Remove unused keys from locale JSON files
  --file <name...>  Analyze only specific namespace files or namespaces
  --lang <name...>  With --write, remove only from specific locales
  --json            Print JSON output
  -h, --help        Show help

Examples:
  pnpm run i18n:prune-unused
  pnpm run i18n:prune-unused --file app common
  pnpm run i18n:prune-unused --write
`)
}

function countUnusedKeys(result: AnalyzeUnusedTranslationsResult) {
  return Object.values(result.unusedKeysByNamespace).reduce((total, keys) => total + keys.length, 0)
}

function printHumanSummary(
  result: AnalyzeUnusedTranslationsResult,
  removed?: RemoveUnusedTranslationsResult,
) {
  const totalUnused = countUnusedKeys(result)
  console.log(`Found ${totalUnused} unused i18n keys.`)

  for (const [namespace, keys] of Object.entries(result.unusedKeysByNamespace)) {
    console.log(`\n${namespace} (${keys.length})`)
    for (const key of keys) console.log(`  - ${key}`)
  }

  if (result.protectedNamespaces.length) {
    console.log(
      `\nProtected namespaces with unresolved dynamic keys: ${result.protectedNamespaces.join(', ')}`,
    )
    console.log(
      'These namespaces were not pruned because at least one key could not be statically resolved.',
    )
  }

  if (result.dynamicKeyPatterns.length) {
    console.log(`\nDynamic key patterns kept: ${result.dynamicKeyPatterns.length}`)
    for (const pattern of result.dynamicKeyPatterns.slice(0, 20)) {
      const suffix = pattern.suffix ? ` ... ${pattern.suffix}` : ''
      console.log(`  - ${pattern.namespace}: ${pattern.prefix}*${suffix}`)
    }
    if (result.dynamicKeyPatterns.length > 20)
      console.log(`  ... ${result.dynamicKeyPatterns.length - 20} more`)
  }

  if (removed) console.log(`\nRemoved ${removed.removedKeys.length} keys across locale files.`)
  else if (totalUnused) console.log('\nRun again with --write to remove these keys.')
}

async function runCli() {
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    return
  }

  if (args.errors.length) {
    for (const error of args.errors) console.error(error)
    printHelp()
    process.exitCode = 1
    return
  }

  const result = await analyzeUnusedTranslations({ files: args.files })
  const removed = args.write
    ? await removeUnusedTranslations({ analysis: result, locales: args.locales })
    : undefined

  if (args.json) {
    console.log(JSON.stringify({ analysis: result, removal: removed }, null, 2))
  } else {
    printHumanSummary(result, removed)
  }

  if (!args.write && countUnusedKeys(result)) process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === entryPath) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Unexpected error: ${message}`)
    process.exit(1)
  })
}

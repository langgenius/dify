import type { CommandTree } from './registry.js'
import { BaseError, unknownError } from '../errors/base.js'
import { formatErrorForCli } from '../errors/format.js'
import { formatHelp } from './help.js'
import { stringifyOutput } from './output.js'
import { findSuggestions, resolveCommand } from './registry.js'

export async function run(tree: CommandTree, argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
    const helpArgv = argv.filter(a => a !== '--help' && a !== '-h' && a !== 'help')

    if (helpArgv.length > 0) {
      const resolved = resolveCommand(tree, helpArgv)

      if (resolved) {
        process.stdout.write(`${formatHelp(resolved.command, resolved.path.join(' '))}\n`)

        return
      }
    }

    printTopLevelHelp(tree)

    return
  }

  const resolved = resolveCommand(tree, argv)

  if (!resolved) {
    process.stderr.write(`unknown command: ${argv.join(' ')}\n`)
    const suggestions = findSuggestions(tree, argv)

    if (suggestions.length > 0) {
      process.stderr.write('\nDid you mean:\n')

      for (const s of suggestions.slice(0, 5))
        process.stderr.write(`  ${s}\n`)
    }

    process.exit(1)
  }

  const Ctor = resolved.command
  if (typeof Ctor.deprecated === 'string' && Ctor.deprecated.length > 0)
    process.stderr.write(`deprecated: ${Ctor.deprecated}\n`)

  let cmd
  try {
    cmd = new Ctor()
  }
  catch (err) {
    handleRunError(err, argv)
    return
  }

  let output
  try {
    output = await cmd.run(argv.slice(resolved.path.length))
  }
  catch (err) {
    handleRunError(err, argv)
    return
  }

  if (output === undefined)
    return

  try {
    process.stdout.write(stringifyOutput(output))
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE')
      process.exit(0)
    throw err
  }
}

export function sniffOutputFormat(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === undefined)
      continue
    if (t === '--')
      return ''

    if (t === '--output' || t === '-o') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-'))
        return next
      continue
    }
    if (t.startsWith('--output='))
      return t.slice('--output='.length)
    if (t.startsWith('-o='))
      return t.slice('-o='.length)
  }
  return ''
}

function printTopLevelHelp(tree: CommandTree): void {
  process.stdout.write('difyctl — Dify command-line interface\n\n')
  process.stdout.write('COMMANDS\n')

  for (const [topic, node] of Object.entries(tree)) {
    if (node.command?.hidden === true)
      continue

    if (node.command) {
      const desc = node.command.description ?? ''
      process.stdout.write(`  ${topic}  ${desc}\n`)
    }
    else {
      process.stdout.write(`  ${topic}\n`)
    }

    for (const [verb, sub] of Object.entries(node.subcommands)) {
      if (sub.command?.hidden === true)
        continue
      const desc = sub.command?.description ?? (Object.keys(sub.subcommands).length > 0 ? `${Object.keys(sub.subcommands).length} subcommands` : '')
      process.stdout.write(`    ${verb}  ${desc}\n`)
    }
  }

  process.stdout.write('\nGLOBAL FLAGS\n')
  process.stdout.write('  -o, --output <string>  output format (varies by command)\n')
  process.stdout.write('  -w, --workspace <string>  workspace id (overrides DIFY_WORKSPACE_ID and stored default)\n')
  process.stdout.write('  --http-retry <integer>  HTTP retry attempts for transient GET/PUT/DELETE errors. 0 disables. Overrides DIFYCTL_HTTP_RETRY.\n')

  process.stdout.write('\nQUICK START\n')
  process.stdout.write('  $ difyctl auth login\n')
  process.stdout.write('  $ difyctl get app\n')
  process.stdout.write('  $ difyctl run app <app-id> "hello"\n')

  process.stdout.write('\n')
}

function safeWriteStderr(text: string): void {
  try {
    process.stderr.write(text)
  }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPIPE')
      throw e
  }
}

function handleRunError(err: unknown, argv: readonly string[]): void {
  const format = sniffOutputFormat(argv)
  if (err instanceof BaseError) {
    safeWriteStderr(`${formatErrorForCli(err, { format, isErrTTY: process.stderr.isTTY })}\n`)
    process.exit(err.exit())
    return
  }
  if (err instanceof Error) {
    const msg = format === 'json'
      ? formatErrorForCli(unknownError(err.message, err), { format, isErrTTY: process.stderr.isTTY })
      : err.message
    safeWriteStderr(`${msg}\n`)
    process.exit(1)
    return
  }
  const msg = format === 'json'
    ? formatErrorForCli(unknownError(String(err), err), { format, isErrTTY: process.stderr.isTTY })
    : String(err)
  safeWriteStderr(`${msg}\n`)
  process.exit(1)
}

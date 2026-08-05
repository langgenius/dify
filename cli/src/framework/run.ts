import type { CommandTree } from './registry'
import { BaseError, unknownError } from '@/errors/base'
import { formatErrorForCli } from '@/errors/format'
import { findTopic } from '@/help/topics'
import { formatCommandList, formatHelp, formatTopic, formatTopLevelHelp } from './help'
import { stringifyOutput } from './output'
import { collectCommands, findSuggestions, resolveCommand } from './registry'

export async function run(tree: CommandTree, argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
    const format = sniffOutputFormat(argv)
    // The command/topic path is the leading positional run; stop at the first
    // flag so output flags like `-o json` never leak into resolution.
    const helpArgv: string[] = []

    for (const a of argv) {
      if (a === 'help' || a === '--help' || a === '-h') continue
      if (a.startsWith('-')) break
      helpArgv.push(a)
    }

    if (helpArgv.length > 0) {
      const resolved = resolveCommand(tree, helpArgv)

      if (resolved) {
        const out = formatHelp(resolved.command, resolved.path.join(' '), format)
        process.stdout.write(isStructuredFormat(format) ? out : `${out}\n`)

        return
      }

      const first = helpArgv[0]

      if (helpArgv.length === 1 && first !== undefined) {
        const topic = findTopic(first)

        if (topic) {
          process.stdout.write(formatTopic(topic, format))

          return
        }
      }

      // Namespace drill-in: `difyctl auth --help` / `difyctl auth devices --help`.
      // Group nodes have no command of their own (no index.ts), so resolveCommand
      // misses them; surface their subtree instead of erroring. A strict-prefix
      // match over the full-depth command walk keeps this purely derived.
      const subtree = collectCommands(tree).filter(
        (c) => c.path.length > helpArgv.length && helpArgv.every((token, i) => c.path[i] === token),
      )

      if (subtree.length > 0) {
        process.stdout.write(formatCommandList(subtree, format))

        return
      }

      process.stderr.write(`unknown help topic: ${helpArgv.join(' ')}\n`)
      const suggestions = findSuggestions(tree, helpArgv)

      if (suggestions.length > 0) {
        process.stderr.write('\nDid you mean:\n')

        for (const s of suggestions.slice(0, 5)) process.stderr.write(`  ${s}\n`)
      }

      process.exit(1)
    }

    process.stdout.write(formatTopLevelHelp(tree, format))

    return
  }

  const resolved = resolveCommand(tree, argv)

  if (!resolved) {
    process.stderr.write(`unknown command: ${argv.join(' ')}\n`)
    const suggestions = findSuggestions(tree, argv)

    if (suggestions.length > 0) {
      process.stderr.write('\nDid you mean:\n')

      for (const s of suggestions.slice(0, 5)) process.stderr.write(`  ${s}\n`)
    }

    process.exit(1)
  }

  try {
    const Ctor = resolved.command
    if (typeof Ctor.deprecated === 'string' && Ctor.deprecated.length > 0)
      process.stderr.write(`deprecated: ${Ctor.deprecated}\n`)
    const cmd = new Ctor()
    const commandArgv = argv.slice(resolved.path.length)
    cmd.processGlobalFlags(commandArgv)

    const output = await cmd.run(commandArgv)
    if (output !== undefined) process.stdout.write(stringifyOutput(output))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0)
    const e =
      err instanceof BaseError
        ? err
        : unknownError(err instanceof Error ? err.message : String(err), err)
    const format = sniffOutputFormat(argv)
    process.stderr.write(`${formatErrorForCli(e, { format, isErrTTY: process.stderr.isTTY })}\n`)
    process.exit(e.exit())
  }
}

export function sniffOutputFormat(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === undefined) continue
    if (t === '--') return ''

    if (t === '--output' || t === '-o') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) return next
      continue
    }
    if (t.startsWith('--output=')) return t.slice('--output='.length)
    if (t.startsWith('-o=')) return t.slice('-o='.length)
  }
  return ''
}

function isStructuredFormat(format: string): boolean {
  return format === 'json' || format === 'yaml'
}

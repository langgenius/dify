import type { CommandTree } from './registry.js'
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

  try {
    const Ctor = resolved.command
    const cmd = new Ctor()
    cmd._setArgv(argv.slice(resolved.path.length))
    const output = await cmd.run()
    if (output !== undefined)
      process.stdout.write(stringifyOutput(output))
  }
  catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`${err.message}\n`)
    }
    else {
      process.stderr.write(`${String(err)}\n`)
    }

    process.exit(1)
  }
}

function printTopLevelHelp(tree: CommandTree): void {
  process.stdout.write('difyctl — Dify command-line interface\n\n')
  process.stdout.write('COMMANDS\n')

  for (const [topic, node] of Object.entries(tree)) {
    if (node.command) {
      const desc = node.command.description ?? ''

      process.stdout.write(`  ${topic}  ${desc}\n`)
    }
    else {
      process.stdout.write(`  ${topic}\n`)
    }

    for (const [verb, sub] of Object.entries(node.subcommands)) {
      const desc = sub.command?.description ?? ''

      process.stdout.write(`    ${verb}  ${desc}\n`)
    }
  }

  process.stdout.write('\n')
}

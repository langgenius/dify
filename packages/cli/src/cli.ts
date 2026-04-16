import process from 'node:process'
import { runMigrationCommand } from './no-unchecked-indexed-access/migrate'
import { runNormalizeCommand } from './no-unchecked-indexed-access/normalize'
import { runBatchMigrationCommand } from './no-unchecked-indexed-access/run'

type CommandHandler = (argv: string[]) => Promise<void>

const COMMANDS = new Map<string, CommandHandler>([
  ['migrate', runMigrationCommand],
  ['normalize', runNormalizeCommand],
  ['run', runBatchMigrationCommand],
])

function printUsage() {
  console.log(`Usage:
  dify-cli no-unchecked-indexed-access migrate [options]
  dify-cli no-unchecked-indexed-access run [options]
  dify-cli no-unchecked-indexed-access normalize`)
}

async function flushStandardStreams() {
  await Promise.all([
    new Promise<void>(resolve => process.stdout.write('', () => resolve())),
    new Promise<void>(resolve => process.stderr.write('', () => resolve())),
  ])
}

async function main() {
  const [group, command, ...restArgs] = process.argv.slice(2)

  if (!group || group === 'help' || group === '--help' || group === '-h') {
    printUsage()
    return
  }

  if (group !== 'no-unchecked-indexed-access') {
    printUsage()
    throw new Error(`Unknown command group: ${group}`)
  }

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage()
    return
  }

  const handler = COMMANDS.get(command)
  if (!handler) {
    printUsage()
    throw new Error(`Unknown command: ${command}`)
  }

  await handler(restArgs)
}

let exitCode = 0

try {
  await main()
  exitCode = process.exitCode ?? 0
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  exitCode = 1
}

await flushStandardStreams()
process.exit(exitCode)

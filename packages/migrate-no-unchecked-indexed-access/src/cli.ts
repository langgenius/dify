import process from 'node:process'
import { runBatchMigrationCommand } from './no-unchecked-indexed-access/run'

function printUsage() {
  console.log(`Usage:
  migrate-no-unchecked-indexed-access [options]

Options:
  --project <path>
  --batch-size <number>
  --batch-iterations <number>
  --max-rounds <number>
  --verbose`)
}

async function flushStandardStreams() {
  await Promise.all([
    new Promise<void>(resolve => process.stdout.write('', () => resolve())),
    new Promise<void>(resolve => process.stderr.write('', () => resolve())),
  ])
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('help') || argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    return
  }

  await runBatchMigrationCommand(argv)
}

let exitCode = 0

try {
  await main()
  const currentExitCode = process.exitCode
  exitCode = typeof currentExitCode === 'number' ? currentExitCode : 0
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  exitCode = 1
}

await flushStandardStreams()
process.exit(exitCode)

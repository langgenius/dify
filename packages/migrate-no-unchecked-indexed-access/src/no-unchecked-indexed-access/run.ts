import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { runMigration, SUPPORTED_DIAGNOSTIC_CODES } from './migrate'

const execFileAsync = promisify(execFile)
const DIAGNOSTIC_PATTERN = /^(.+?\.(?:ts|tsx))\((\d+),(\d+)\): error TS(\d+): (.+)$/
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_BATCH_ITERATIONS = 5
const DEFAULT_MAX_ROUNDS = 20
const TYPECHECK_CACHE_DIR = path.join(os.tmpdir(), 'migrate-no-unchecked-indexed-access')

type CliOptions = {
  batchIterations: number
  batchSize: number
  maxRounds: number
  project: string
  verbose: boolean
}

type DiagnosticEntry = {
  code: number
  fileName: string
  line: number
  message: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    batchIterations: DEFAULT_BATCH_ITERATIONS,
    batchSize: DEFAULT_BATCH_SIZE,
    maxRounds: DEFAULT_MAX_ROUNDS,
    project: 'tsconfig.json',
    verbose: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--')
      continue

    if (arg === '--verbose') {
      options.verbose = true
      continue
    }

    if (arg === '--project') {
      const value = argv[i + 1]
      if (!value)
        throw new Error('Missing value for --project')

      options.project = value
      i += 1
      continue
    }

    if (arg === '--batch-size') {
      const value = Number(argv[i + 1])
      if (!Number.isInteger(value) || value <= 0)
        throw new Error('Invalid value for --batch-size')

      options.batchSize = value
      i += 1
      continue
    }

    if (arg === '--batch-iterations') {
      const value = Number(argv[i + 1])
      if (!Number.isInteger(value) || value <= 0)
        throw new Error('Invalid value for --batch-iterations')

      options.batchIterations = value
      i += 1
      continue
    }

    if (arg === '--max-rounds') {
      const value = Number(argv[i + 1])
      if (!Number.isInteger(value) || value <= 0)
        throw new Error('Invalid value for --max-rounds')

      options.maxRounds = value
      i += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function getTypeCheckBuildInfoPath(projectPath: string): string {
  const hash = createHash('sha1')
    .update(projectPath)
    .digest('hex')
    .slice(0, 16)

  return path.join(TYPECHECK_CACHE_DIR, `${hash}.tsbuildinfo`)
}

async function runTypeCheck(
  project: string,
  options?: {
    incremental?: boolean
  },
): Promise<{ diagnostics: DiagnosticEntry[], exitCode: number, rawOutput: string }> {
  const projectPath = path.resolve(process.cwd(), project)
  const projectDirectory = path.dirname(projectPath)
  const buildInfoPath = getTypeCheckBuildInfoPath(projectPath)
  const incremental = options?.incremental ?? true

  await fs.mkdir(TYPECHECK_CACHE_DIR, { recursive: true })

  const tscArgs = ['exec', 'tsc', '--noEmit', '--pretty', 'false']
  if (incremental) {
    tscArgs.push('--incremental', '--tsBuildInfoFile', buildInfoPath)
  }
  else {
    tscArgs.push('--incremental', 'false')
  }
  tscArgs.push('--project', projectPath)

  try {
    const { stdout, stderr } = await execFileAsync('pnpm', tscArgs, {
      cwd: projectDirectory,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192',
      },
      maxBuffer: 1024 * 1024 * 32,
    })

    const rawOutput = `${stdout}${stderr}`.trim()
    return {
      diagnostics: parseDiagnostics(rawOutput, projectDirectory),
      exitCode: 0,
      rawOutput,
    }
  }
  catch (error) {
    const exitCode = typeof error === 'object' && error && 'code' in error && typeof error.code === 'number'
      ? error.code
      : 1
    const stdout = typeof error === 'object' && error && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : ''
    const stderr = typeof error === 'object' && error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr
      : ''
    const rawOutput = `${stdout}${stderr}`.trim()

    return {
      diagnostics: parseDiagnostics(rawOutput, projectDirectory),
      exitCode,
      rawOutput,
    }
  }
}

function parseDiagnostics(rawOutput: string, projectDirectory: string): DiagnosticEntry[] {
  return rawOutput
    .split('\n')
    .map(line => line.trim())
    .flatMap((line) => {
      const match = line.match(DIAGNOSTIC_PATTERN)
      if (!match)
        return []

      return [{
        code: Number(match[4]),
        fileName: path.resolve(projectDirectory, match[1]!),
        line: Number(match[2]),
        message: match[5] ?? '',
      }]
    })
}

function summarizeCodes(diagnostics: DiagnosticEntry[]): string {
  const counts = new Map<number, number>()
  for (const diagnostic of diagnostics)
    counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1)

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([code, count]) => `TS${code}:${count}`)
    .join(', ')
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size)
    batches.push(items.slice(i, i + size))

  return batches
}

async function runBatchMigration(options: CliOptions) {
  for (let round = 1; round <= options.maxRounds; round += 1) {
    const { diagnostics, exitCode, rawOutput } = await runTypeCheck(options.project)
    if (exitCode === 0) {
      const finalCheck = await runTypeCheck(options.project, { incremental: false })
      if (finalCheck.exitCode !== 0) {
        const finalDiagnostics = finalCheck.diagnostics
        console.log(`Final cold type check found ${finalDiagnostics.length} diagnostic(s). ${summarizeCodes(finalDiagnostics)}`)

        if (options.verbose) {
          for (const diagnostic of finalDiagnostics.slice(0, 40))
            console.log(`${path.relative(process.cwd(), diagnostic.fileName)}:${diagnostic.line} TS${diagnostic.code} ${diagnostic.message}`)
        }

        const finalSupportedFiles = Array.from(new Set(
          finalDiagnostics
            .filter(diagnostic => SUPPORTED_DIAGNOSTIC_CODES.has(diagnostic.code))
            .map(diagnostic => diagnostic.fileName),
        ))

        if (finalSupportedFiles.length > 0) {
          console.log(`  Final pass batch: ${finalSupportedFiles.length} file(s)`)
          let finalResult = await runMigration({
            files: finalSupportedFiles,
            maxIterations: options.batchIterations,
            project: options.project,
            verbose: options.verbose,
            write: true,
          })

          if (finalResult.totalEdits === 0) {
            console.log('    No edits produced; retrying final pass with full project roots.')
            finalResult = await runMigration({
              files: finalSupportedFiles,
              maxIterations: options.batchIterations,
              project: options.project,
              useFullProjectRoots: true,
              verbose: options.verbose,
              write: true,
            })
          }

          if (finalResult.totalEdits > 0)
            continue
        }

        if (finalCheck.rawOutput)
          process.stderr.write(`${finalCheck.rawOutput}\n`)
        process.exitCode = 1
        return
      }

      console.log(`Type check passed after ${round - 1} migration round(s).`)
      return
    }

    const supportedDiagnostics = diagnostics.filter(diagnostic => SUPPORTED_DIAGNOSTIC_CODES.has(diagnostic.code))
    const unsupportedDiagnostics = diagnostics.filter(diagnostic => !SUPPORTED_DIAGNOSTIC_CODES.has(diagnostic.code))
    const supportedFiles = Array.from(new Set(supportedDiagnostics.map(diagnostic => diagnostic.fileName)))

    console.log(`Round ${round}: ${diagnostics.length} diagnostic(s). ${summarizeCodes(diagnostics)}`)

    if (options.verbose) {
      for (const diagnostic of diagnostics.slice(0, 40))
        console.log(`${path.relative(process.cwd(), diagnostic.fileName)}:${diagnostic.line} TS${diagnostic.code} ${diagnostic.message}`)
    }

    if (supportedFiles.length === 0) {
      console.error('No supported diagnostics remain to migrate.')
      if (unsupportedDiagnostics.length > 0) {
        console.error('Remaining unsupported diagnostics:')
        for (const diagnostic of unsupportedDiagnostics.slice(0, 40))
          console.error(`${path.relative(process.cwd(), diagnostic.fileName)}:${diagnostic.line} TS${diagnostic.code} ${diagnostic.message}`)
      }
      if (rawOutput)
        process.stderr.write(`${rawOutput}\n`)
      process.exitCode = 1
      return
    }

    let roundEdits = 0
    const batches = chunk(supportedFiles, options.batchSize)

    for (const [index, batch] of batches.entries()) {
      console.log(`  Batch ${index + 1}/${batches.length}: ${batch.length} file(s)`)
      let result = await runMigration({
        files: batch,
        maxIterations: options.batchIterations,
        project: options.project,
        verbose: options.verbose,
        write: true,
      })

      if (result.totalEdits === 0) {
        console.log('    No edits produced; retrying batch with full project roots.')
        result = await runMigration({
          files: batch,
          maxIterations: options.batchIterations,
          project: options.project,
          useFullProjectRoots: true,
          verbose: options.verbose,
          write: true,
        })
      }

      roundEdits += result.totalEdits
    }

    if (roundEdits === 0) {
      console.error('Migration script made no edits in this round; stopping to avoid an infinite loop.')
      process.exitCode = 1
      return
    }
  }

  console.error(`Reached --max-rounds=${options.maxRounds} before type check passed.`)
  process.exitCode = 1
}

export async function runBatchMigrationCommand(argv: string[]) {
  await runBatchMigration(parseArgs(argv))
}

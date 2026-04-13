import { spawn, type ChildProcess } from 'node:child_process'
import { access, copyFile, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sleep } from '../support/process'

type RunCommandOptions = {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  stdio?: 'inherit' | 'pipe'
}

type RunCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type ForegroundProcessOptions = {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

export const rootDir = fileURLToPath(new URL('../..', import.meta.url))
export const e2eDir = path.join(rootDir, 'e2e')
export const apiDir = path.join(rootDir, 'api')
export const dockerDir = path.join(rootDir, 'docker')
export const webDir = path.join(rootDir, 'web')

export const middlewareComposeFile = path.join(dockerDir, 'docker-compose.middleware.yaml')
export const middlewareEnvFile = path.join(dockerDir, 'middleware.env')
export const middlewareEnvExampleFile = path.join(dockerDir, 'middleware.env.example')
export const webEnvLocalFile = path.join(webDir, '.env.local')
export const webEnvExampleFile = path.join(webDir, '.env.example')
export const apiEnvExampleFile = path.join(apiDir, 'tests', 'integration_tests', '.env.example')

const formatCommand = (command: string, args: string[]) => [command, ...args].join(' ')

export const isMainModule = (metaUrl: string) => {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false

  return pathToFileURL(entrypoint).href === metaUrl
}

export const runCommand = async ({
  command,
  args,
  cwd,
  env,
  stdio = 'inherit',
}: RunCommandOptions): Promise<RunCommandResult> => {
  const childProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: stdio === 'inherit' ? 'inherit' : 'pipe',
  })

  let stdout = ''
  let stderr = ''

  if (stdio === 'pipe') {
    childProcess.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    childProcess.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
  }

  return await new Promise<RunCommandResult>((resolve, reject) => {
    childProcess.once('error', reject)
    childProcess.once('exit', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      })
    })
  })
}

export const runCommandOrThrow = async (options: RunCommandOptions) => {
  const result = await runCommand(options)

  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${result.exitCode}): ${formatCommand(options.command, options.args)}`,
    )
  }

  return result
}

const forwardSignalsToChild = (childProcess: ChildProcess) => {
  const handleSignal = (signal: NodeJS.Signals) => {
    if (childProcess.exitCode === null) childProcess.kill(signal)
  }

  const onSigint = () => handleSignal('SIGINT')
  const onSigterm = () => handleSignal('SIGTERM')

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  return () => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

export const runForegroundProcess = async ({
  command,
  args,
  cwd,
  env,
}: ForegroundProcessOptions) => {
  const childProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: 'inherit',
  })

  const cleanupSignals = forwardSignalsToChild(childProcess)
  const exitCode = await new Promise<number>((resolve, reject) => {
    childProcess.once('error', reject)
    childProcess.once('exit', (code) => {
      resolve(code ?? 1)
    })
  })

  cleanupSignals()
  process.exit(exitCode)
}

export const ensureFileExists = async (filePath: string, exampleFilePath: string) => {
  try {
    await access(filePath)
  } catch {
    await copyFile(exampleFilePath, filePath)
  }
}

export const ensureLineInFile = async (filePath: string, line: string) => {
  const fileContent = await readFile(filePath, 'utf8')
  const lines = fileContent.split(/\r?\n/)
  const assignmentPrefix = line.includes('=') ? `${line.slice(0, line.indexOf('='))}=` : null

  if (lines.includes(line)) return

  if (assignmentPrefix && lines.some((existingLine) => existingLine.startsWith(assignmentPrefix)))
    return

  const normalizedContent = fileContent.endsWith('\n') ? fileContent : `${fileContent}\n`
  await writeFile(filePath, `${normalizedContent}${line}\n`, 'utf8')
}

export const ensureWebEnvLocal = async () => {
  await ensureFileExists(webEnvLocalFile, webEnvExampleFile)

  const fileContent = await readFile(webEnvLocalFile, 'utf8')
  const nextContent = fileContent.replaceAll('http://localhost:5001', 'http://127.0.0.1:5001')

  if (nextContent !== fileContent) await writeFile(webEnvLocalFile, nextContent, 'utf8')
}

export const readSimpleDotenv = async (filePath: string) => {
  const fileContent = await readFile(filePath, 'utf8')
  const entries = fileContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map<[string, string]>((line) => {
      const separatorIndex = line.indexOf('=')
      const key = separatorIndex === -1 ? line : line.slice(0, separatorIndex).trim()
      const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1).trim()

      if (
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        return [key, rawValue.slice(1, -1)]
      }

      return [key, rawValue]
    })

  return Object.fromEntries(entries)
}

export const waitForCondition = async ({
  check,
  description,
  intervalMs,
  timeoutMs,
}: {
  check: () => Promise<boolean> | boolean
  description: string
  intervalMs: number
  timeoutMs: number
}) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await check()) return

    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms.`)
}

export const isTcpPortReachable = async (host: string, port: number, timeoutMs = 1_000) => {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({
      host,
      port,
    })

    const finish = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

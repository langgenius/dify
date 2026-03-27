import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

type ManagedProcessOptions = {
  command: string
  cwd: string
  env?: NodeJS.ProcessEnv
  label: string
  logFilePath: string
}

export type ManagedProcess = {
  childProcess: ChildProcess
  label: string
  logFilePath: string
  logStream: WriteStream
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export const isPortReachable = async (host: string, port: number, timeoutMs = 1_000) => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`http://${host}:${port}`, {
        signal: controller.signal,
      })

      return response.status > 0
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return false
  }
}

export const waitForUrl = async (url: string, timeoutMs: number, intervalMs = 1_000) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), intervalMs)

      try {
        const response = await fetch(url, {
          signal: controller.signal,
        })
        if (response.ok) return
      } finally {
        clearTimeout(timeout)
      }
    } catch {
      // Keep polling until timeout.
    }

    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms.`)
}

export const startLoggedProcess = async ({
  command,
  cwd,
  env,
  label,
  logFilePath,
}: ManagedProcessOptions): Promise<ManagedProcess> => {
  await mkdir(dirname(logFilePath), { recursive: true })

  const logStream = createWriteStream(logFilePath, { flags: 'a' })
  const childProcess = spawn(command, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  logStream.write(`[${new Date().toISOString()}] Starting ${label}: ${command}\n`)
  childProcess.stdout?.pipe(logStream, { end: false })
  childProcess.stderr?.pipe(logStream, { end: false })

  return {
    childProcess,
    label,
    logFilePath,
    logStream,
  }
}

export const stopManagedProcess = async (managedProcess?: ManagedProcess) => {
  if (!managedProcess) return

  const { childProcess, logStream } = managedProcess

  if (!childProcess.killed && childProcess.exitCode === null) {
    childProcess.kill()
    await new Promise<void>((resolve) => {
      childProcess.once('exit', () => resolve())
      setTimeout(() => resolve(), 5_000)
    })
  }

  await new Promise<void>((resolve) => {
    logStream.end(() => resolve())
  })
}

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { dirname } from 'node:path'

type ManagedProcessOptions = {
  command: string
  args?: string[]
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

export const waitForUrl = async (
  url: string,
  timeoutMs: number,
  intervalMs = 1_000,
  requestTimeoutMs = Math.max(intervalMs, 1_000),
) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

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
  args = [],
  cwd,
  env,
  label,
  logFilePath,
}: ManagedProcessOptions): Promise<ManagedProcess> => {
  await mkdir(dirname(logFilePath), { recursive: true })

  const logStream = createWriteStream(logFilePath, { flags: 'a' })
  const childProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const formattedCommand = [command, ...args].join(' ')
  logStream.write(`[${new Date().toISOString()}] Starting ${label}: ${formattedCommand}\n`)
  childProcess.stdout?.pipe(logStream, { end: false })
  childProcess.stderr?.pipe(logStream, { end: false })

  return {
    childProcess,
    label,
    logFilePath,
    logStream,
  }
}

const waitForProcessExit = (childProcess: ChildProcess, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    if (childProcess.exitCode !== null) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)

    const onExit = () => {
      cleanup()
      resolve()
    }

    const cleanup = () => {
      clearTimeout(timeout)
      childProcess.off('exit', onExit)
    }

    childProcess.once('exit', onExit)
  })

const signalManagedProcess = (childProcess: ChildProcess, signal: NodeJS.Signals) => {
  const { pid } = childProcess
  if (!pid) return

  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, signal)
      return
    }

    childProcess.kill(signal)
  } catch {
    // Best-effort shutdown. Cleanup continues even when the process is already gone.
  }
}

export const stopManagedProcess = async (managedProcess?: ManagedProcess) => {
  if (!managedProcess) return

  const { childProcess, logStream } = managedProcess

  if (childProcess.exitCode === null) {
    signalManagedProcess(childProcess, 'SIGTERM')
    await waitForProcessExit(childProcess, 5_000)
  }

  if (childProcess.exitCode === null) {
    signalManagedProcess(childProcess, 'SIGKILL')
    await waitForProcessExit(childProcess, 5_000)
  }

  childProcess.stdout?.unpipe(logStream)
  childProcess.stderr?.unpipe(logStream)
  childProcess.stdout?.destroy()
  childProcess.stderr?.destroy()

  await new Promise<void>((resolve) => {
    logStream.end(() => resolve())
  })
}

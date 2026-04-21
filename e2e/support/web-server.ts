import { readFile } from 'node:fs/promises'
import type { ManagedProcess } from './process'
import { isPortReachable, startLoggedProcess, stopManagedProcess, waitForUrl } from './process'

type WebServerStartOptions = {
  baseURL: string
  command: string
  args?: string[]
  cwd: string
  logFilePath: string
  reuseExistingServer: boolean
  timeoutMs: number
}

let activeProcess: ManagedProcess | undefined

const readLogTail = async (logFilePath: string, maxLines = 120) => {
  try {
    const content = await readFile(logFilePath, 'utf8')
    const lines = content.split(/\r?\n/)
    return lines.slice(-maxLines).join('\n').trim()
  } catch {
    return ''
  }
}

const getUrlHostAndPort = (url: string) => {
  const parsedUrl = new URL(url)
  const isHttps = parsedUrl.protocol === 'https:'

  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : isHttps ? 443 : 80,
  }
}

export const startWebServer = async ({
  baseURL,
  command,
  args = [],
  cwd,
  logFilePath,
  reuseExistingServer,
  timeoutMs,
}: WebServerStartOptions) => {
  const { host, port } = getUrlHostAndPort(baseURL)

  if (reuseExistingServer && (await isPortReachable(host, port))) return

  activeProcess = await startLoggedProcess({
    command,
    args,
    cwd,
    label: 'web server',
    logFilePath,
  })

  let startupError: Error | undefined
  activeProcess.childProcess.once('error', (error) => {
    startupError = error
  })
  activeProcess.childProcess.once('exit', (code, signal) => {
    if (startupError) return

    startupError = new Error(
      `Web server exited before readiness (code: ${code ?? 'unknown'}, signal: ${signal ?? 'none'}).`,
    )
  })

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (startupError) {
      const logTail = await readLogTail(logFilePath)
      await stopManagedProcess(activeProcess)
      activeProcess = undefined
      if (logTail) startupError.message = `${startupError.message}\n--- web log tail ---\n${logTail}`
      throw startupError
    }

    try {
      await waitForUrl(baseURL, 1_000, 250, 1_000)
      return
    } catch {
      // Continue polling until timeout or child exit.
    }
  }

  await stopManagedProcess(activeProcess)
  activeProcess = undefined
  const logTail = await readLogTail(logFilePath)
  throw new Error(
    `Timed out waiting for web server readiness at ${baseURL} after ${timeoutMs}ms.${logTail ? `\n--- web log tail ---\n${logTail}` : ''}`,
  )
}

export const stopWebServer = async () => {
  await stopManagedProcess(activeProcess)
  activeProcess = undefined
}

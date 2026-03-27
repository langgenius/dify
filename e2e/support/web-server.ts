import type { ManagedProcess } from './process'
import { isPortReachable, startLoggedProcess, stopManagedProcess, waitForUrl } from './process'

type WebServerStartOptions = {
  baseURL: string
  command: string
  cwd: string
  logFilePath: string
  reuseExistingServer: boolean
  timeoutMs: number
}

type WebServerStartResult = {
  pid?: number
  reusedExistingServer: boolean
}

let activeProcess: ManagedProcess | undefined

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
  cwd,
  logFilePath,
  reuseExistingServer,
  timeoutMs,
}: WebServerStartOptions): Promise<WebServerStartResult> => {
  const { host, port } = getUrlHostAndPort(baseURL)

  if (reuseExistingServer && (await isPortReachable(host, port))) {
    return {
      reusedExistingServer: true,
    }
  }

  activeProcess = await startLoggedProcess({
    command,
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
      await stopManagedProcess(activeProcess)
      activeProcess = undefined
      throw startupError
    }

    try {
      await waitForUrl(baseURL, 1_000, 250)
      return {
        pid: activeProcess.childProcess.pid,
        reusedExistingServer: false,
      }
    } catch {
      // Continue polling until timeout or child exit.
    }
  }

  await stopManagedProcess(activeProcess)
  activeProcess = undefined
  throw new Error(`Timed out waiting for web server readiness at ${baseURL} after ${timeoutMs}ms.`)
}

export const stopWebServer = async () => {
  await stopManagedProcess(activeProcess)
  activeProcess = undefined
}

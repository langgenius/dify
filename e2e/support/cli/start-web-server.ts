import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopWebServer, startWebServer } from '../web-server'
import { baseURL, reuseExistingWebServer } from '../../test-env'

const e2eRoot = fileURLToPath(new URL('../..', import.meta.url))
const defaultReadyFilePath = path.join(e2eRoot, '.logs', 'web-server.ready.json')
const defaultLogFilePath = path.join(e2eRoot, '.logs', 'cucumber-web.log')

const readyFilePath = process.env.E2E_WEB_SERVER_READY_FILE || defaultReadyFilePath
const logFilePath = process.env.E2E_WEB_SERVER_LOG_PATH || defaultLogFilePath

const writeReadyFile = async (payload: Record<string, unknown>) => {
  await mkdir(path.dirname(readyFilePath), { recursive: true })
  await writeFile(readyFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

const cleanup = async () => {
  await stopWebServer()
  await rm(readyFilePath, { force: true })
}

try {
  const result = await startWebServer({
    baseURL,
    command: 'npx tsx ./scripts/start-web.ts',
    cwd: e2eRoot,
    logFilePath,
    reuseExistingServer: reuseExistingWebServer,
    timeoutMs: 300_000,
  })

  await writeReadyFile({
    baseURL,
    logFilePath,
    pid: result.pid,
    reusedExistingServer: result.reusedExistingServer,
  })

  const handleSignal = async () => {
    await cleanup()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void handleSignal()
  })
  process.on('SIGTERM', () => {
    void handleSignal()
  })

  await new Promise(() => {})
} catch (error) {
  await writeReadyFile({
    baseURL,
    error: error instanceof Error ? error.message : String(error),
    logFilePath,
  })
  throw error
}

import { ensureWebEnvLocal, e2eDir, isMainModule, runCommand } from './common'
import { resetState } from './reset-state'
import { startMiddleware } from './start-middleware'
import { stopMiddleware } from './stop-middleware'

const main = async () => {
  await ensureWebEnvLocal()
  await resetState()
  await startMiddleware()

  let cleanupPromise: Promise<void> | undefined
  const cleanup = async () => {
    if (!cleanupPromise) cleanupPromise = stopMiddleware()

    await cleanupPromise
  }

  const onTerminate = () => {
    void cleanup().finally(() => {
      process.exit(1)
    })
  }

  process.once('SIGINT', onTerminate)
  process.once('SIGTERM', onTerminate)

  try {
    const result = await runCommand({
      command: 'npx',
      args: ['playwright', 'test', ...process.argv.slice(2)],
      cwd: e2eDir,
    })

    process.exitCode = result.exitCode
  } finally {
    process.off('SIGINT', onTerminate)
    process.off('SIGTERM', onTerminate)
    await cleanup()
  }
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { dockerDir, e2eDir, isMainModule } from './common'
import { stopMiddleware } from './stop-middleware'

const middlewareDataPaths = [
  path.join(dockerDir, 'volumes', 'db', 'data'),
  path.join(dockerDir, 'volumes', 'plugin_daemon'),
  path.join(dockerDir, 'volumes', 'redis', 'data'),
  path.join(dockerDir, 'volumes', 'weaviate'),
]

const e2eStatePaths = [
  path.join(e2eDir, '.auth'),
  path.join(e2eDir, 'cucumber-report'),
  path.join(e2eDir, '.logs'),
  path.join(e2eDir, 'playwright-report'),
  path.join(e2eDir, 'test-results'),
]

export const resetState = async () => {
  console.log('Stopping middleware services...')
  try {
    await stopMiddleware()
  } catch {
    // Reset should continue even if middleware is already stopped.
  }

  console.log('Removing persisted middleware data...')
  await Promise.all(
    middlewareDataPaths.map(async (targetPath) => {
      await rm(targetPath, { force: true, recursive: true })
      await mkdir(targetPath, { recursive: true })
    }),
  )

  console.log('Removing E2E local state...')
  await Promise.all(
    e2eStatePaths.map((targetPath) => rm(targetPath, { force: true, recursive: true })),
  )

  console.log('E2E state reset complete.')
}

const main = async () => {
  await resetState()
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

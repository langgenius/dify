import { access } from 'node:fs/promises'
import path from 'node:path'
import { isMainModule, runCommandOrThrow, runForegroundProcess, webDir } from './common'

const buildIdPath = path.join(webDir, '.next', 'BUILD_ID')

export const startWeb = async () => {
  if (process.env.E2E_FORCE_WEB_BUILD === '1') {
    await runCommandOrThrow({
      command: 'pnpm',
      args: ['run', 'build'],
      cwd: webDir,
    })
  } else {
    try {
      await access(buildIdPath)
      console.log('Reusing existing web build artifact.')
    } catch {
      await runCommandOrThrow({
        command: 'pnpm',
        args: ['run', 'build'],
        cwd: webDir,
      })
    }
  }

  await runForegroundProcess({
    command: 'pnpm',
    args: ['run', 'start'],
    cwd: webDir,
    env: {
      HOSTNAME: '127.0.0.1',
      PORT: '3000',
    },
  })
}

const main = async () => {
  await startWeb()
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

import path from 'node:path'
import { rootDir } from '../scripts/common.ts'
import { startLoggedProcess } from './process.ts'

export const startWebBuildDownload = async (logDir: string) => {
  const managedProcess = await startLoggedProcess({
    command: process.execPath,
    args: ['.github/actions/wait-e2e-web-build/download.cjs'],
    cwd: rootDir,
    label: 'Web build download',
    logFilePath: path.join(logDir, 'cucumber-web-build.log'),
  })

  // Capture failures immediately, even while the runner is still starting the API.
  // Resolving with the error avoids an unhandled rejection before the join point.
  const completed = new Promise<Error | undefined>((resolve) => {
    managedProcess.childProcess.once('error', resolve)
    managedProcess.childProcess.once('close', (code) => {
      resolve(
        code === 0
          ? undefined
          : new Error(
              `Web build download failed (${code ?? 'signal'}). See ${managedProcess.logFilePath}.`,
            ),
      )
    })
  })

  return { process: managedProcess, completed }
}

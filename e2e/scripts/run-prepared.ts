import { e2eDir, isMainModule, runForegroundProcess } from './common.ts'
import './env-register.ts'

const preparedTags = '@prepared'

const main = async () => {
  await runForegroundProcess({
    command: process.execPath,
    args: [
      './scripts/run-cucumber.ts',
      '--full',
      '--profile',
      'prepared',
      '--',
      '--tags',
      preparedTags,
    ],
    cwd: e2eDir,
  })
}

if (isMainModule(import.meta.url)) void main()

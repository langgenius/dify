import { e2eDir, isMainModule, runForegroundProcess } from './common'
import './env-register'

const preparedTags = '@prepared'

const main = async () => {
  await runForegroundProcess({
    command: 'npx',
    args: [
      'tsx',
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

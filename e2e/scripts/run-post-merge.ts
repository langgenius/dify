import { e2eDir, isMainModule, runForegroundProcess } from './common.ts'
import './env-register.ts'

const postMergeTags = '@prepared or @external-model or @external-tool'

const main = async () => {
  await runForegroundProcess({
    command: process.execPath,
    args: [
      './scripts/run-cucumber.ts',
      '--full',
      '--profile',
      'post-merge',
      '--',
      '--tags',
      postMergeTags,
    ],
    cwd: e2eDir,
  })
}

if (isMainModule(import.meta.url)) void main()

import { e2eDir, isMainModule, runForegroundProcess } from './common'
import './env-register'

const defaultExternalRuntimeTags = '@external-model or @external-tool'

const main = async () => {
  await runForegroundProcess({
    command: process.execPath,
    args: [
      '--import',
      'tsx',
      './scripts/run-cucumber.ts',
      '--full',
      '--profile',
      'external-runtime',
      '--',
      '--tags',
      defaultExternalRuntimeTags,
    ],
    cwd: e2eDir,
  })
}

if (isMainModule(import.meta.url)) void main()

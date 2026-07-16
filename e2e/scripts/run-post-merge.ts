import { e2eDir, isMainModule, runForegroundProcess } from './common'
import './env-register'

const postMergeTags = '@prepared or @external-model or @external-tool'

const main = async () => {
  await runForegroundProcess({
    command: 'npx',
    args: ['tsx', './scripts/run-cucumber.ts', '--', '--tags', postMergeTags],
    cwd: e2eDir,
  })
}

if (isMainModule(import.meta.url)) void main()

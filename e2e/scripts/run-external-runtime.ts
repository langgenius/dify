import { e2eDir, isMainModule, runForegroundProcess } from './common'
import './env-register'

const defaultExternalRuntimeTags =
  '(@external-model or @external-tool) and not @feature-gated and not @skip and not @preview'

const main = async () => {
  const tags = process.env.E2E_EXTERNAL_RUNTIME_TAGS?.trim() || defaultExternalRuntimeTags

  await runForegroundProcess({
    command: 'npx',
    args: ['tsx', './scripts/run-cucumber.ts', '--', '--tags', tags],
    cwd: e2eDir,
  })
}

if (isMainModule(import.meta.url)) void main()

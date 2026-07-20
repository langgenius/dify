import { e2eDir, isMainModule, runCommandOrThrow } from './common'
import './env-register'

const main = async () => {
  await runCommandOrThrow({
    command: 'npx',
    args: ['tsx', './scripts/seed.ts', '--pack', 'agent-v2', '--profile', 'external-runtime'],
    cwd: e2eDir,
  })
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

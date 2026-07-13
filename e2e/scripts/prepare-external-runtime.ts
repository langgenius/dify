import { e2eDir, isMainModule, runCommandOrThrow } from './common'
import './env-register'

const defaultExternalRuntimeSeedSpecs = 'agent-v2:external-runtime'

const parseSeedSpecs = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [pack, profile = 'full'] = entry.split(':').map((part) => part.trim())
      if (!pack)
        throw new Error(
          `Invalid external runtime seed spec "${entry}". Expected "pack" or "pack:profile".`,
        )

      return { pack, profile }
    })

const main = async () => {
  const seedSpecs = parseSeedSpecs(
    process.env.E2E_EXTERNAL_RUNTIME_SEED_SPECS?.trim() || defaultExternalRuntimeSeedSpecs,
  )

  for (const { pack, profile } of seedSpecs) {
    await runCommandOrThrow({
      command: 'npx',
      args: ['tsx', './scripts/seed.ts', '--pack', pack, '--profile', profile],
      cwd: e2eDir,
    })
  }
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

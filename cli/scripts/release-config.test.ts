import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { main } from './release-naming.mjs'

const env = Object.fromEntries(
  main(['github-env'])
    .split('\n')
    .filter(Boolean)
    .map((line: string) => line.split(/=(.*)/s).slice(0, 2)),
)

// Install scripts run standalone on an end user's machine — no repo, no node —
// so they hardcode artifact names instead of asking release-naming.mjs. These
// checks are what keeps the two copies from drifting: change the naming config
// and they fail until the installers are updated to match.
const INSTALLERS = ['install-cli.sh', 'install-r2.sh', 'install.ps1', 'install-r2.ps1']
const installerText = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

const CHECKSUMS_SUFFIX = main(['checksums', '1.2.3']).trim().replace(`${env.tagPrefix}1.2.3`, '')

const EXE_TARGET_ID = main(['targets'])
  .trim()
  .split('\n')
  .map((line: string) => line.split('\t'))
  .find(([, , exe]: string[]) => exe === '1')?.[1]

describe('install scripts stay aligned with the release naming config', () => {
  it.each(INSTALLERS)('%s uses the configured tag prefix', (name) => {
    expect(installerText(name)).toContain(env.tagPrefix)
  })

  it.each(INSTALLERS)('%s uses the configured checksums suffix', (name) => {
    expect(installerText(name)).toContain(CHECKSUMS_SUFFIX)
  })

  it.each(['install.ps1', 'install-r2.ps1'])('%s targets the declared windows build', (name) => {
    expect(EXE_TARGET_ID).toBeTruthy()
    expect(installerText(name)).toContain(EXE_TARGET_ID)
  })
})

describe('the shipped difyctl release config', () => {
  it('passes the release gate (`release-naming.mjs validate`)', () => {
    expect(main(['validate'])).toMatch(/^difyctl release valid:/)
  })

  it('declares a usable, correctly ordered compat window', () => {
    expect(main(['compat-check', env.minDify])).toContain('compatible')
    expect(main(['compat-check', env.maxDify])).toContain('compatible')
  })

  it('gates a Dify version outside the declared window', () => {
    const aboveMax = `${Number(env.maxDify.split('.')[0]) + 1}.0.0`
    expect(() => main(['compat-check', aboveMax])).toThrow('outside difyctl compatibility window')
    expect(() => main(['compat-check', '0.0.1'])).toThrow('outside difyctl compatibility window')
  })

  it('declares a version valid for the channel it ships on', () => {
    expect(main(['validate-version', env.version, env.channel])).toContain('valid')
  })

  it('can name an artifact for every target it declares', () => {
    const ids = main(['targets'])
      .trim()
      .split('\n')
      .map((line: string) => line.split('\t')[1])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(main(['asset', env.version, id])).toContain(id)
  })
})

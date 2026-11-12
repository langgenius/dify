import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const artifactsRoot = join(projectRoot, '.vitest-browser')
mkdirSync(artifactsRoot, { recursive: true })
const runDir = mkdtempSync(join(artifactsRoot, 'trace-regression-'))
const tracesDir = join(runDir, 'traces')
const fixturePath = join(runDir, 'retention.fixture.ts')
const configPath = join(runDir, 'vitest.config.ts')
const resultsPath = join(runDir, 'results.json')

const fixture = String.raw`import { page } from 'vite-plus/test/browser'
import { expect, it, describe, aroundEach, onTestFinished } from 'vite-plus/test'
it('ordinary passing trace', async () => { document.body.innerHTML = '<button>Native trace action</button>'; await page.getByRole('button', { name: 'Native trace action' }).click(); expect(true).toBe(true) })
it('ordinary failing trace', () => { expect('intentional failure').toBe('failure retained') })
it.fails('expected failure discarded', () => { expect(false).toBe(true) })
it.fails('unexpected pass retained', () => { expect(true).toBe(true) })
let passingAttempts = 0
it('retried passing trace discarded', { retry: 1 }, () => { expect(++passingAttempts).toBe(2) })
it('retried failing traces retained', { retry: 1 }, () => { expect(false).toBe(true) })
let repeats = 0
it('repeat failure retains every attempt', { repeats: 1 }, () => { expect(++repeats).toBe(1) })

it('retains onTestFinished failures', () => {
  onTestFinished(() => { throw new Error('intentional finished-hook failure') })
})
describe('aroundEach teardown', () => {
  aroundEach(async run => { await run(); throw new Error('intentional aroundEach teardown failure') })
  it('retains teardown failures after a passing body', () => { expect(true).toBe(true) })
})
`
const expectedArchives = [
  'browser--chromium--aroundEach-teardown-retains-teardown-failures-after-a-passing-body-0-0.trace.zip',
  'browser--chromium--ordinary-failing-trace-0-0.trace.zip',
  'browser--chromium--repeat-failure-retains-every-attempt-0-0.trace.zip',
  'browser--chromium--repeat-failure-retains-every-attempt-1-0.trace.zip',
  'browser--chromium--retains-onTestFinished-failures-0-0.trace.zip',
  'browser--chromium--retried-failing-traces-retained-0-0.trace.zip',
  'browser--chromium--retried-failing-traces-retained-0-1.trace.zip',
  'browser--chromium--unexpected-pass-retained-0-0.trace.zip',
]

writeFileSync(fixturePath, fixture)
writeFileSync(
  configPath,
  `
import original from '../../vite.config.ts'
export default async (env) => {
  const config = await original(env)
  config.cacheDir = ${JSON.stringify(join(runDir, 'cache'))}
  config.test.attachmentsDir = ${JSON.stringify(join(runDir, 'attachments'))}
  const browser = config.test.projects.find(project => project.test.name === 'browser')
  browser.test.include = [${JSON.stringify(fixturePath)}]
  browser.optimizeDeps.include = [...browser.optimizeDeps.include, 'react-i18next']
  browser.test.browser.trace = {
    ...browser.test.browser.trace,
    mode: 'retain-on-failure',
    tracesDir: ${JSON.stringify(tracesDir)},
  }
  return config
}
`,
)

const run = spawnSync(
  'vp',
  [
    'test',
    'run',
    '--config',
    configPath,
    '--project',
    'browser',
    '--maxWorkers=1',
    '--reporter=json',
    `--outputFile=${resultsPath}`,
  ],
  {
    cwd: projectRoot,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  },
)
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
writeFileSync(join(runDir, 'vitest.log'), output)

function readZipEntry(archive, name) {
  const result = spawnSync('unzip', ['-p', archive, name], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `Cannot read ${name}: ${result.stderr || result.error}`)
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

try {
  assert.equal(run.error, undefined)
  // Six final failures are intentional, including expected-pass inversion and cleanup failures.
  assert.equal(run.status, 1, output)
  assert.ok(!output.includes('unexpectedly reloaded'), output)
  const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
  assert.equal(results.numTotalTests, 9)
  assert.equal(results.numPassedTests, 3)
  assert.equal(results.numFailedTests, 6)
  const archives = readdirSync(tracesDir)
    .filter((name) => name.endsWith('.trace.zip'))
    .sort()
  assert.deepEqual(archives, expectedArchives)
  for (const name of archives) {
    const archive = join(tracesDir, name)
    const integrity = spawnSync('unzip', ['-tqq', archive], { encoding: 'utf8' })
    assert.equal(
      integrity.status,
      0,
      `Invalid archive ${name}: ${integrity.stderr || integrity.error}`,
    )
    const trace = readZipEntry(archive, 'trace.trace')
    assert.ok(
      trace.some((event) => event.type === 'context-options'),
      `Missing context in ${name}`,
    )
    assert.ok(
      trace.some((event) => event.type === 'frame-snapshot'),
      `Missing DOM snapshot in ${name}`,
    )
    assert.ok(
      readZipEntry(archive, 'trace.network').length > 0,
      `Missing network records in ${name}`,
    )
  }
  rmSync(runDir, { recursive: true })
  process.stdout.write(
    'Verified 8 retained traces across failures, retries, repeats, and cleanup hooks.\n',
  )
} catch (error) {
  console.error(error)
  console.error(`Trace verification artifacts: ${runDir}`)
  console.error(output)
  process.exitCode = 1
}

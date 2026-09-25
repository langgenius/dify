import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
// oxlint-disable-next-line vitest/no-import-node-test -- Exercise the installed dependency patch independently of Vite.
import { test } from 'node:test'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'

const require = createRequire(new URL('../../web/package.json', import.meta.url))
const dist = path.dirname(require.resolve('@vitejs/devtools-oxc'))
const bundle = (await fs.readdir(dist)).find((name) => /^devframe-.*\.mjs$/.test(name))
const source = await fs.readFile(path.join(dist, bundle), 'utf8')
const discovery = source.slice(
  source.indexOf('//#region src/node/utils/config-files.ts'),
  source.indexOf('//#region src/node/utils/oxlint.ts'),
)
const inspector = source.slice(
  source.indexOf('//#region src/node/rpc/functions/oxlint-inspect-config.ts'),
  source.indexOf('//#region src/node/utils/package-manager.ts'),
)

test('discovers ancestor configs without scanning siblings and confines inspection to the workspace', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'devtools-oxc-'))
  try {
    const workspace = path.join(root, 'workspace')
    const cwd = path.join(workspace, 'web')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(path.join(workspace, 'sibling'))
    await fs.writeFile(path.join(workspace, 'vite.config.ts'), 'export default { lint: {} }')
    await fs.writeFile(path.join(cwd, 'oxlint.config.ts'), 'export default {}')
    await fs.writeFile(path.join(workspace, 'sibling/oxlint.config.ts'), 'export default {}')
    await fs.writeFile(path.join(root, 'oxlint.config.ts'), 'export default {}')
    let inspected
    const { getOxcConfigFiles, configWorkspaceRoot, oxlintInspectConfig } = runInNewContext(
      `${discovery}\n${inspector}\n({ getOxcConfigFiles, configWorkspaceRoot, oxlintInspectConfig })`,
      {
        ...fs,
        ...path,
        resolve$1: path.resolve,
        relative$1: path.relative,
        execFile,
        promisify,
        defineOxcRpc: (value) => value,
        diagnostics: { OXDT0004: (value) => new Error(value.reason) },
        inspectConfig: async (options) => {
          inspected = options
          return { stats: { builtinRules: 1 } }
        },
      },
    )
    const configs = await getOxcConfigFiles(
      cwd,
      configWorkspaceRoot({ cwd, workspaceRoot: workspace }),
    )
    assert.deepEqual(Array.from(configs, (config) => config.path).sort(), [
      '../vite.config.ts',
      'oxlint.config.ts',
    ])
    assert.equal(configWorkspaceRoot({ cwd, workspaceRoot: path.join(root, 'unrelated') }), cwd)
    const { handler } = oxlintInspectConfig.setup({ cwd, workspaceRoot: workspace })
    await handler('../vite.config.ts')
    assert.equal(inspected.cwd, cwd)
    assert.equal(inspected.configFile, await fs.realpath(path.join(workspace, 'vite.config.ts')))
    await assert.rejects(handler('../../oxlint.config.ts'), /relative to the workspace/)
    await fs.symlink(path.join(root, 'oxlint.config.ts'), path.join(cwd, '.oxlintrc.json'))
    await assert.rejects(handler('.oxlintrc.json'), /outside the workspace/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('config selection preserves explicit choices and otherwise prefers project then nearest ancestor', async () => {
  const assets = path.join(dist, 'public/_nuxt')
  const contents = await Promise.all(
    (await fs.readdir(assets))
      .filter((name) => name.endsWith('.js'))
      .map((name) => fs.readFile(path.join(assets, name), 'utf8')),
  )
  const code = contents.find((content) =>
    content.includes('function ee(e,t,n){if(t)return e.includes(t)'),
  )
  assert.ok(code)
  const fn = code.slice(code.indexOf('function ee('), code.indexOf('function V('))
  const choose = runInNewContext(`${fn}; ee`)
  const paths = ['../../vite.config.ts', '../vite.config.ts', 'oxlint.config.ts']
  assert.equal(choose(paths, '', ''), 'oxlint.config.ts')
  assert.equal(choose(paths.slice(0, 2), '', ''), '../vite.config.ts')
  assert.equal(choose(paths, '../../vite.config.ts', ''), '../../vite.config.ts')
  assert.equal(choose(paths, '', '../../vite.config.ts'), '../../vite.config.ts')
  assert.equal(choose(paths, 'missing.ts', ''), '')
})

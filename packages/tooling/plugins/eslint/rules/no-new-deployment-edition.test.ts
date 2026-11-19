import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'

const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
const typeImport =
  "import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'\n"
const atomImport = "import { deploymentEditionAtom } from '@/features/system-features/state'\n"
const check = "const enabled = deploymentEdition === 'CLOUD'\n"

type Options = {
  before?: string
  path?: string
  oldPath?: string
  base?: string
}

function lintFixture(
  source: string,
  { before = '', path = 'web/example.tsx', oldPath = path, base }: Options = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'dify-edition-guard-'))
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), content)
  }
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Guard Tests')
    git('config', 'user.email', 'guard@example.com')
    write('README.md', 'Edition guard fixture\n')
    if (before) write(oldPath, before)
    git('add', '.')
    git('commit', '-m', 'guard fixture')
    const baseline = git('rev-parse', 'HEAD')
    if (before && path !== oldPath) {
      mkdirSync(dirname(join(directory, path)), { recursive: true })
      git('mv', oldPath, path)
    }
    write(path, source)
    write(
      'plugin.mjs',
      `import rule from ${JSON.stringify(require.resolve('./no-new-deployment-edition.ts'))};
export default { meta: { name: 'dify' }, rules: { 'no-new-deployment-edition': rule } };`,
    )
    write(
      '.oxlintrc.json',
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: ['./plugin.mjs'],
        rules: { 'dify/no-new-deployment-edition': 'error' },
      }),
    )
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', '.oxlintrc.json', '--format', 'json', path],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, DIFY_EDITION_GUARD_BASE_REV: base ?? baseline },
      },
    )
    expect(result.error).toBeUndefined()
    expect([0, 1], result.stderr + result.stdout).toContain(result.status)
    const response: { diagnostics: { message: string }[] } = JSON.parse(result.stdout)
    return response.diagnostics
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it.each([
  typeImport,
  "import { type DeploymentEdition as Edition } from '@dify/contracts/api/console/system-features/types.gen'\n",
  atomImport,
  "import { deploymentEditionAtom as raw } from '@/features/system-features/state'\n",
  "import { deploymentEditionAtom as raw } from './features/system-features/state'\n",
  "import * as features from '@/features/system-features/state'\nconst state = features\nconst raw = state.deploymentEditionAtom\n",
  check,
  "const enabled = 'ENTERPRISE' !== features.deployment_edition\n",
  "const enabled = features['deployment_edition'] === 'CLOUD'\n",
  "const enabled = (\n deploymentEdition\n === 'CLOUD'\n)\n",
  "const editionAlias = deploymentEdition\nconst enabled = editionAlias === 'CLOUD'\n",
  `${atomImport}const raw = useAtomValue(deploymentEditionAtom)\nconst enabled = raw === 'CLOUD'\n`,
  "const enabled = ['CLOUD', 'ENTERPRISE'].includes(deploymentEdition)\n",
  'const enabled = allowed.has(features.deployment_edition)\n',
  "switch (deploymentEdition) { case 'CLOUD': enable(); break }\n",
])('rejects new edition dependencies and decisions: %s', (source) => {
  expect(lintFixture(source).length).toBeGreaterThan(0)
})

it.each([
  "import { enabledAtom } from '@/features/system-features/state'\n",
  "import type { DeploymentEdition } from 'other-library'\n",
  'const enabled = isAgentV2Enabled()\n',
  'const edition = features.deployment_edition; console.log(edition)\n',
  "const enabled = storageType === 'CLOUD'\n",
  "import type { DeploymentEdition } from 'other-library'\nfunction enabled(value: DeploymentEdition) { return value === 'CLOUD' }\n",
  "// deploymentEdition === 'CLOUD'\nconst sample = \"deploymentEdition === 'CLOUD'\"\n",
])('allows policies, metadata and unrelated syntax: %s', (source) => {
  expect(lintFixture(source)).toEqual([])
})

it('preserves existing occurrences but rejects copies and changed decisions', () => {
  expect(lintFixture(`${check}const answer = 42\n`, { before: check })).toEqual([])
  expect(lintFixture(check + check, { before: check })).toHaveLength(1)
  expect(lintFixture(check.replace('CLOUD', 'ENTERPRISE'), { before: check })).toHaveLength(1)
})

it('preserves formatting and import aliases without allowing additional imports', () => {
  expect(
    lintFixture(typeImport.replace('DeploymentEdition }', 'DeploymentEdition as Edition }'), {
      before: typeImport,
    }),
  ).toEqual([])
  expect(
    lintFixture('const enabled = (\n deploymentEdition === "CLOUD"\n)\n', { before: check }),
  ).toEqual([])
  expect(lintFixture(typeImport + typeImport, { before: typeImport })).toHaveLength(1)
})

it('checks new decisions even when the raw edition atom was already imported', () => {
  const source = `${
    atomImport
  }const raw = useAtomValue(deploymentEditionAtom)\nconst enabled = raw === 'CLOUD'\n`
  expect(lintFixture(source, { before: atomImport })).toHaveLength(1)
})

it.each([
  `${typeImport}function enabled(value: DeploymentEdition) { return true }\n`,
  "import type * as Types from '@dify/contracts/api/console/system-features/types.gen'\nfunction enabled(value: Types.DeploymentEdition) { return true }\n",
])('checks new decisions through parameters with existing edition types: %s', (before) => {
  expect(
    lintFixture(before.replace('return true', "return value === 'CLOUD'"), { before }),
  ).toHaveLength(1)
})

it('preserves switch bodies but detects additional cases', () => {
  const before = "switch (deploymentEdition) { case 'CLOUD': enable(); break }\n"
  expect(lintFixture(before.replace('enable()', 'configure()'), { before })).toEqual([])
  expect(
    lintFixture(before.replace('break }', "break; case 'ENTERPRISE': configure(); break }"), {
      before,
    }),
  ).toHaveLength(1)
})

it.each([
  'web/features/system-features/state.ts',
  'web/features/agent-v2/feature-flag.ts',
  'web/features/agent-v2/agent-detail/configure/feature-flags.ts',
  'web/features/contacts/management/feature-flag.ts',
  'web/features/contacts/im-platform/feature-flag.ts',
])('allows the explicit feature policy module %s', (path) => {
  expect(lintFixture(typeImport + check, { path })).toEqual([])
})

it.each(['web/example.spec.tsx', 'web/features/another/feature-flag.ts'])(
  'does not exempt tests or similarly named policies: %s',
  (path) => {
    expect(lintFixture(check, { path })).toHaveLength(1)
  },
)

it('preserves ordinary file renames but removes feature policy exemptions on a move', () => {
  expect(lintFixture(check, { before: check, oldPath: 'web/old file.tsx' })).toEqual([])
  expect(
    lintFixture(check, { before: check, oldPath: 'web/features/agent-v2/feature-flag.ts' }),
  ).toHaveLength(1)
})

it('resolves relative imports against the original filename when a module moves', () => {
  const before = [
    "import { deploymentEditionAtom as raw } from './features/system-features/state'",
    'export function useExistingCapability() {',
    '  const currentEdition = useAtomValue(raw)',
    "  return currentEdition === 'CLOUD'",
    '}',
    'export function useExistingWorkspaceCapability() {',
    '  const currentEdition = useAtomValue(raw)',
    "  return currentEdition === 'ENTERPRISE'",
    '}',
  ].join('\n')
  expect(
    lintFixture(before.replace("'./features/", "'../features/"), {
      before,
      oldPath: 'web/example.tsx',
      path: 'web/components/example.tsx',
    }),
  ).toEqual([])
})

it('provides actionable guidance and reports invalid baselines', () => {
  const diagnostic = lintFixture(check)[0]!
  expect(diagnostic.message).toContain('Read docs/FEATURE_FLAGS.md#fixing-a-lint-error')
  expect(lintFixture(check, { base: 'missing-revision' })[0]!.message).toContain(
    'Fetch the target branch and rerun lint.',
  )
})

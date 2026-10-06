import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'

function lintFixture(source, rules) {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-disable-description-'))
  try {
    writeFileSync(
      join(directory, 'plugin.mjs'),
      `export { default } from ${JSON.stringify(require.resolve('../index.js'))};`,
    )
    writeFileSync(
      join(directory, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: ['./plugin.mjs'],
        options: { respectEslintDisableDirectives: false },
        rules,
      }),
    )
    writeFileSync(join(directory, 'fixture.jsx'), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', 'fixture.jsx'],
      {
        cwd: directory,
        encoding: 'utf8',
      },
    )
    expect(result.error).toBeUndefined()
    expect([0, 1], result.stderr + result.stdout).toContain(result.status)
    return JSON.parse(result.stdout).diagnostics
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('checks actual Oxlint directives, including JSX and both prefixes, without requiring enable reasons', () => {
  const diagnostics = lintFixture(
    [
      '// oxlint-disable-next-line no-console',
      'console.log(1);',
      'console.log(2); // oxlint-disable-line no-console --   ',
      '/* oxlint-disable no-console */',
      'console.log(3);',
      '/* oxlint-enable no-console */',
      '// oxlint-disable-next-line no-console -- CLI output is intentional.',
      'console.log(4);',
      'const content = <div>',
      '  {/* oxlint-disable-next-line jsx-a11y/anchor-has-content */}',
      '  <a />',
      '  {/* oxlint-disable-next-line jsx-a11y/anchor-has-content -- The renderer supplies the accessible name. */}',
      '  <a />',
      '</div>;',
      '// An ordinary comment mentioning oxlint-disable is not a directive.',
      '// eslint-disable-next-line no-console',
      'console.log(5);',
    ].join('\n'),
    { 'dify/require-disable-directive-description': 'error' },
  )
  expect(diagnostics.map(({ code, labels }) => ({ code, line: labels[0].span.line }))).toEqual([
    { code: 'dify(require-disable-directive-description)', line: 1 },
    { code: 'dify(require-disable-directive-description)', line: 3 },
    { code: 'dify(require-disable-directive-description)', line: 4 },
    { code: 'dify(require-disable-directive-description)', line: 10 },
    { code: 'dify(require-disable-directive-description)', line: 16 },
  ])
})

it.each([
  ['different linter enable', '/* oxlint-disable no-console */\n/* eslint-enable no-console */', 1],
  ['unclosed rule', '/* oxlint-disable no-console -- Legacy output. */\nconsole.log(1)', 1],
  ['blanket disable', '/* oxlint-disable -- Legacy file. */\nconsole.log(1)', 1],
  ['ESLint prefix', '/* eslint-disable no-console -- Legacy output. */\nconsole.log(1)', 1],
  ['wrong enable', '/* oxlint-disable no-console */\n/* oxlint-enable no-debugger */', 1],
  [
    'partial enable',
    '/* oxlint-disable no-console, no-debugger */\n/* oxlint-enable no-console */',
    1,
  ],
  ['enable before disable', '/* oxlint-enable no-console */\n/* oxlint-disable no-console */', 1],
  [
    'paired interval',
    '/* oxlint-disable no-console */\nconsole.log(1)\n/* oxlint-enable no-console */',
    0,
  ],
  [
    'separate enables',
    '/* oxlint-disable no-console, no-debugger */\n/* oxlint-enable no-console */\n/* oxlint-enable no-debugger */',
    0,
  ],
  ['enable all', '/* oxlint-disable no-console */\n/* oxlint-enable */', 0],
  ['blanket interval', '/* oxlint-disable */\nconsole.log(1)\n/* oxlint-enable */', 1],
  [
    'line disables',
    '// oxlint-disable-next-line no-console\nconsole.log(1)\nconsole.log(2) // oxlint-disable-line no-console',
    0,
  ],
])('enforces bounded disables: %s', (_name, source, count) => {
  const diagnostics = lintFixture(source, {
    'dify/no-file-wide-disable': 'error',
    'unicorn/no-abusive-eslint-disable': 'error',
  })
  expect(diagnostics).toHaveLength(count)
  for (const diagnostic of diagnostics) {
    expect(diagnostic.code).toBe(
      _name.startsWith('blanket')
        ? 'unicorn(no-abusive-eslint-disable)'
        : 'dify(no-file-wide-disable)',
    )
    expect(diagnostic.severity).toBe('error')
  }
})

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

function install(browser, fail = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-install-'))
  try {
    fs.mkdirSync(path.join(directory, 'e2e'))
    const bin = path.join(directory, 'bin')
    fs.mkdirSync(bin)
    for (const command of ['uv', 'vp', 'pnpm']) {
      fs.writeFileSync(
        path.join(bin, command),
        `#!/usr/bin/env bash
echo "${command} $*" >> "$INSTALL_CALLS"
phase=${command}
if [[ "$phase" == pnpm ]]; then phase=$3; fi
if [[ "$phase" == "$INSTALL_FAIL" ]]; then exit 23; fi
`,
        { mode: 0o755 },
      )
    }
    const calls = path.join(directory, 'calls')
    const summary = path.join(directory, 'summary')
    const result = spawnSync('bash', [path.join(__dirname, 'install.sh')], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        E2E_INSTALL_BROWSER: browser,
        GITHUB_STEP_SUMMARY: summary,
        INSTALL_CALLS: calls,
        INSTALL_FAIL: fail,
      },
    })
    return {
      ...result,
      calls: fs.readFileSync(calls, 'utf8'),
      summary: fs.readFileSync(summary, 'utf8'),
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

for (const browser of ['chromium', 'webkit']) {
  test(`installs ${browser} system dependencies and browser separately`, () => {
    const result = install(browser)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.calls, /uv sync --project api --dev/)
    assert.match(
      result.calls
        .split('\n')
        .filter((line) => !line.startsWith('uv '))
        .join('\n'),
      new RegExp(
        `vp install --frozen-lockfile\npnpm exec playwright install-deps ${browser}\npnpm exec playwright install --only-shell ${browser}`,
      ),
    )
    for (const phase of ['api', 'web', 'browser-system', 'browser-download']) {
      assert.match(result.summary, new RegExp(`\\| ${phase} \\| \\d+ \\| 0 \\|`))
    }
  })
}

for (const [command, phase, skipped] of [
  ['uv', 'api', null],
  ['vp', 'web', 'pnpm'],
  ['install-deps', 'browser-system', 'install --only-shell'],
  ['install', 'browser-download', null],
]) {
  test(`records ${phase} failure and waits for the other branch`, () => {
    const result = install('chromium', command)
    assert.equal(result.status, 1)
    assert.match(result.summary, new RegExp(`\\| ${phase} \\| \\d+ \\| 23 \\|`))
    assert.match(
      result.summary,
      new RegExp(`\\| ${phase === 'api' ? 'browser-download' : 'api'} \\| \\d+ \\| 0 \\|`),
    )
    if (skipped) assert.ok(!result.calls.includes(skipped))
  })
}

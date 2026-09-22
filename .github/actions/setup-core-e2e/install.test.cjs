const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

function runPreparation(t, { browser = 'chromium', imageExit = '0', existingEnv } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dify-e2e-preparation-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['bin', 'e2e', 'docker/envs'])
    mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, 'docker/envs/middleware.env.example'), 'EXAMPLE=1\n')
  if (existingEnv) writeFileSync(path.join(root, 'docker/middleware.env'), existingEnv)

  // Barriers fail if the image pull and either package install run serially.
  const command = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.PREPARATION_TEST_ROOT
const name = path.basename(process.argv[1])
const args = process.argv.slice(2)
fs.appendFileSync(path.join(root, 'commands'), JSON.stringify({ name, args }) + '\\n')
const install = name !== 'vp' || args[0] === 'install'
if (install) {
  fs.writeFileSync(path.join(root, name + '.started'), '')
  const peers = name === 'docker' ? ['uv', 'vp'] : ['docker']
  const deadline = Date.now() + 5000
  while (!peers.every(peer => fs.existsSync(path.join(root, peer + '.started')))) {
    if (Date.now() > deadline) process.exit(99)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
}
if (name === 'docker') process.exit(Number(process.env.PREPARATION_TEST_IMAGE_EXIT))
`
  for (const name of ['uv', 'vp', 'docker'])
    writeFileSync(path.join(root, 'bin', name), command, { mode: 0o755 })
  const result = spawnSync('bash', [path.join(__dirname, 'install.sh')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
      E2E_INSTALL_BROWSER: browser,
      PREPARATION_TEST_ROOT: root,
      PREPARATION_TEST_IMAGE_EXIT: imageExit,
      GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
    },
  })
  assert.ifError(result.error)
  return {
    result,
    commands: readFileSync(path.join(root, 'commands'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    summary: readFileSync(path.join(root, 'summary'), 'utf8'),
    middlewareEnv: readFileSync(path.join(root, 'docker/middleware.env'), 'utf8'),
  }
}

for (const browser of ['chromium', 'webkit']) {
  test(`pulls core images alongside dependency installation for ${browser}`, (t) => {
    const { result, commands, summary, middlewareEnv } = runPreparation(t, { browser })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(commands.find((command) => command.name === 'docker').args, [
      'compose',
      '-f',
      'docker/docker-compose.middleware.yaml',
      '--profile',
      'postgresql',
      '--profile',
      'weaviate',
      'pull',
      'db_postgres',
      'redis',
      'weaviate',
      'sandbox',
      'ssrf_proxy',
      'plugin_daemon',
    ])
    assert.ok(
      commands.some(
        (command) => command.name === 'vp' && command.args[1] === `e2e:install:ci:${browser}`,
      ),
    )
    assert.match(summary, /\| images \| \d+ \|/)
    assert.match(summary, /Images exit status: 0/)
    assert.equal(middlewareEnv, 'EXAMPLE=1\n')
  })
}

test('fails preparation on an image pull error after collecting the other branches', (t) => {
  const { result, summary } = runPreparation(t, { imageExit: '17' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /API: 0, Web\/browser: 0, Images: 17/)
  assert.match(summary, /Images exit status: 17/)
})

test('preserves an existing middleware environment file', (t) => {
  const { result, middlewareEnv } = runPreparation(t, { existingEnv: 'EXISTING=1\n' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(middlewareEnv, 'EXISTING=1\n')
})

const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')

const root = path.resolve(__dirname, '../../..')
const webRequire = createRequire(path.join(root, 'web/package.json'))
const { load } = webRequire('js-yaml')
const readYaml = (file) => load(readFileSync(path.join(root, file), 'utf8'))
const workflow = readYaml('.github/workflows/web-bundle-size.yml')
const setup = readYaml('.github/actions/setup-web/action.yml')

test('runtime cache opt-in reaches toolchain setup without runtime-service shell variables', () => {
  assert.equal(setup.inputs['runtime-cache'].default, 'false')

  for (const input of ['true', 'false']) {
    let toolchain
    for (const step of setup.runs.steps) {
      if (step.uses?.startsWith('pnpm/setup@')) {
        toolchain = step
        break
      }
      if (!step.run) continue

      const env = { PATH: process.env.PATH }
      for (const [name, value] of Object.entries(step.env ?? {})) {
        env[name] = value === '${{ inputs.runtime-cache }}' ? input : value
      }
      // Shell steps do not receive the cache service environment that JS actions get.
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        env,
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    assert.ok(toolchain, 'web setup must reach the runtime installer')
    assert.equal(toolchain.with.cache, '${{ inputs.runtime-cache }}')
    assert.equal(toolchain.with['save-cache'], false)
  }
})

test('runtime cache consumers have no write credentials or referenced secrets', () => {
  const directory = path.join(root, '.github/workflows')
  for (const filename of readdirSync(directory).filter((file) => /\.ya?ml$/.test(file))) {
    const current = readYaml(`.github/workflows/${filename}`)
    for (const [name, job] of Object.entries(current.jobs)) {
      const consumes = job.steps?.some((step) =>
        step.uses === './.github/actions/setup-web'
          ? step.with?.['runtime-cache'] === 'true'
          : step.uses?.startsWith('pnpm/setup@') && step.with?.cache === true,
      )
      if (!consumes) continue
      if (job['cache-mode'] === 'write-only') {
        assert.equal(
          filename,
          'web-runtime-cache.yml',
          'only the trusted preparation workflow may populate runtime caches',
        )
        continue
      }

      const label = `${filename}: ${name}`
      assert.equal(job['cache-mode'] ?? current['cache-mode'], 'read', label)
      assert.deepEqual(job.permissions ?? current.permissions, { contents: 'read' }, label)
      assert.ok(!job.secrets && !JSON.stringify(job).includes('secrets.'), label)
    }
  }
})

test('runtime cache preparation only downloads trusted main-branch runtimes', () => {
  const producer = readYaml('.github/workflows/web-runtime-cache.yml')
  assert.deepEqual(Object.keys(producer.on).sort(), ['push', 'workflow_dispatch'])
  assert.deepEqual(producer.on.push.branches, ['main'])
  assert.deepEqual(producer.permissions, { contents: 'read' })
  for (const job of Object.values(producer.jobs)) {
    assert.equal(job['cache-mode'], 'write-only')
    assert.ok(!job.secrets && !JSON.stringify(job).includes('secrets.'))
    for (const [repository, ref, expected] of [
      ['langgenius/dify', 'refs/heads/main', true],
      ['langgenius/dify', 'refs/heads/feature', false],
      ['langgenius/dify', 'refs/pull/1/merge', false],
      ['someone/dify', 'refs/heads/main', false],
    ]) {
      assert.equal(runInNewContext(job.if, { github: { repository, ref } }), expected)
    }
    assert.ok(job.steps.every((step) => !step.run))
    assert.ok(job.steps.every((step) => /^(actions\/checkout|pnpm\/setup)@/.test(step.uses)))
    assert.ok(job.steps.every((step) => /@[a-f0-9]{40}$/.test(step.uses)))
    const runtime = job.steps.find((step) => step.uses.startsWith('pnpm/setup@'))
    assert.equal(runtime.with.install, false)
    assert.equal(runtime.with.cache, true)
    assert.equal(runtime.with['save-cache'], true)
    assert.ok(
      job.steps
        .filter((step) => step.uses.startsWith('actions/checkout@'))
        .every((step) => step.with['persist-credentials'] === false),
    )
  }
})

test('bundle jobs that execute repository code have read-only credentials', () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (!job.steps.some((step) => step.uses?.startsWith('actions/checkout@'))) continue

    const permissions = job.permissions ?? workflow.permissions
    assert.equal(permissions.contents, 'read', name)
    assert.ok(
      !Object.values(permissions).includes('write'),
      `${name} has a write-capable GitHub token`,
    )
    assert.equal(job['cache-mode'] ?? workflow['cache-mode'], 'read', `${name} can write caches`)
  }
})

test('PR comment publication cannot restore caches or execute checked-out code', () => {
  const publishers = Object.values(workflow.jobs).filter(
    (job) => job.permissions?.['pull-requests'] === 'write',
  )
  assert.equal(publishers.length, 1)

  for (const job of publishers) {
    assert.deepEqual(job.permissions, { 'pull-requests': 'write' })
    assert.equal(job['cache-mode'] ?? workflow['cache-mode'], 'none')
    assert.ok(
      job.steps.every((step) => !step.run),
      'publisher must not execute repository scripts',
    )
    assert.ok(
      job.steps.every((step) =>
        /^(actions\/download-artifact|actions\/github-script)@/.test(step.uses),
      ),
    )
    assert.ok(job.steps.every((step) => /@[a-f0-9]{40}$/.test(step.uses)))
    const download = job.steps.find((step) => step.uses.startsWith('actions/download-artifact@'))
    assert.ok(
      !download.with['run-id'] && !download.with.repository && !download.with['github-token'],
    )
    for (const [eventName, headRepository, expected] of [
      ['pull_request', 'langgenius/dify', true],
      ['pull_request', 'someone/dify', false],
      ['merge_group', 'langgenius/dify', false],
    ]) {
      assert.equal(
        runInNewContext(job.if, {
          github: {
            event_name: eventName,
            repository: 'langgenius/dify',
            event: { pull_request: { head: { repo: { full_name: headRepository } } } },
          },
        }),
        expected,
      )
    }
  }
})

async function publish({ shouldComment = true, existing = false, current = {} } = {}) {
  const marker = '<!-- dify-vinext-bundle-size -->'
  const body = `${marker}\nReport data: $(echo data) \`data\` <script>data</script>`
  const comments = existing
    ? [{ id: 1, user: { login: 'github-actions[bot]' }, body: `${marker}\nOld report` }]
    : []
  const job = Object.values(workflow.jobs).find(
    (candidate) => candidate.permissions?.['pull-requests'] === 'write',
  )
  const script = job.steps.find((step) => step.uses.startsWith('actions/github-script@')).with
    .script
  await runInNewContext(`(async () => { ${script} })()`, {
    require: (id) => {
      assert.equal(id, 'node:fs')
      return { readFileSync: () => body }
    },
    process: {
      env: { SHOULD_COMMENT: String(shouldComment), REPORT_PATH: '/report/bundle-report.md' },
    },
    context: {
      repo: { owner: 'langgenius', repo: 'dify' },
      payload: { pull_request: { number: 1, head: { sha: 'head' }, base: { sha: 'base' } } },
    },
    core: { info: () => {} },
    github: {
      paginate: async () => comments.slice(),
      rest: {
        pulls: {
          get: async () => ({
            data: { state: 'open', head: { sha: 'head' }, base: { sha: 'base' }, ...current },
          }),
        },
        issues: {
          listComments: () => {},
          createComment: async (input) => comments.push({ id: 1, body: input.body }),
          updateComment: async (input) => {
            comments.find((comment) => comment.id === input.comment_id).body = input.body
          },
          deleteComment: async (input) =>
            comments.splice(
              comments.findIndex((comment) => comment.id === input.comment_id),
              1,
            ),
        },
      },
    },
  })
  return { comments, body }
}

for (const existing of [false, true]) {
  test(`bundle report ${existing ? 'updates' : 'creates'} a comment with literal report data`, async () => {
    const { comments, body } = await publish({ existing })
    assert.equal(comments.length, 1)
    assert.equal(comments[0].body, body)
  })

  test(`below-threshold reports leave ${existing ? 'no stale comment' : 'no new comment'}`, async () => {
    const { comments } = await publish({ shouldComment: false, existing })
    assert.equal(comments.length, 0)
  })
}

for (const current of [
  { state: 'closed' },
  { head: { sha: 'new-head' } },
  { base: { sha: 'new-base' } },
]) {
  test(`superseded report preserves existing comments: ${JSON.stringify(current)}`, async () => {
    const { comments } = await publish({ existing: true, current })
    assert.equal(comments.length, 1)
    assert.equal(comments[0].body, '<!-- dify-vinext-bundle-size -->\nOld report')
  })
}

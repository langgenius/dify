const assert = require('node:assert/strict')
const test = require('node:test')
const gate = require('./knowledge-deploy-gates.cjs')
const sha = 'a'.repeat(40)
const otherSha = 'b'.repeat(40)
function fixture() {
  const source = {
    event: 'push',
    conclusion: 'success',
    head_branch: 'deploy/konwledge',
    head_repository: { full_name: 'langgenius/dify' },
    head_sha: sha,
  }
  let time = 0
  let branchSha = sha
  let runs = [{ ...source, status: 'completed', run_number: 2, run_attempt: 1 }]
  const outputs = {}
  const requests = []
  return {
    source,
    outputs,
    requests,
    setRuns: (value) => {
      runs = value
    },
    setBranch: (value) => {
      branchSha = value
    },
    args: {
      context: { repo: { owner: 'langgenius', repo: 'dify' }, payload: { workflow_run: source } },
      github: {
        rest: {
          repos: { getBranch: async () => ({ data: { commit: { sha: branchSha } } }) },
          actions: {
            listWorkflowRuns: async (request) => {
              requests.push(request)
              return { data: { workflow_runs: runs } }
            },
          },
        },
      },
      core: {
        info: () => {},
        setOutput: (key, value) => {
          outputs[key] = value
        },
      },
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    },
  }
}
test('only a successful CI run from the same branch, repo, event, and SHA admits deployment', async () => {
  const f = fixture()
  await gate(f.args)
  assert.equal(f.outputs.current, 'true')
  assert.equal(f.requests[0].head_sha, sha)
  assert.equal(f.requests[0].workflow_id, 'knowledge-fs-ci.yml')
})
for (const [name, mutation] of [
  ['pull request', { event: 'pull_request' }],
  ['failed build', { conclusion: 'failure' }],
  ['foreign branch', { head_branch: 'main' }],
  ['foreign repo', { head_repository: { full_name: 'attacker/fork' } }],
  ['invalid revision', { head_sha: 'main' }],
])
  test(`rejects ${name} workflow events before any API query`, async () => {
    const f = fixture()
    Object.assign(f.source, mutation)
    await assert.rejects(gate(f.args), /trusted branch push/)
    assert.deepEqual(f.requests, [])
  })
for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral'])
  test(`CI ${conclusion} fails closed`, async () => {
    const f = fixture()
    f.setRuns([{ ...f.source, status: 'completed', conclusion }])
    await assert.rejects(gate(f.args), /did not succeed/)
    assert.notEqual(f.outputs.current, 'true')
  })
for (const mutation of [
  { head_sha: otherSha },
  { head_branch: 'main' },
  { event: 'pull_request' },
  { head_repository: { full_name: 'attacker/fork' } },
])
  test(`ignores unrelated successful CI run ${JSON.stringify(mutation)}`, async () => {
    const f = fixture()
    f.setRuns([{ ...f.source, ...mutation, status: 'completed' }])
    await assert.rejects(gate(f.args), /Timed out/)
    assert.notEqual(f.outputs.current, 'true')
  })
test('latest failed attempt cannot be hidden by an earlier successful run', async () => {
  const f = fixture()
  f.setRuns([
    { ...f.source, status: 'completed', run_number: 1, run_attempt: 1 },
    { ...f.source, status: 'completed', run_number: 2, run_attempt: 1, conclusion: 'failure' },
  ])
  await assert.rejects(gate(f.args), /did not succeed/)
})
test('stale revision skips without waiting or deploying', async () => {
  const f = fixture()
  f.setBranch(otherSha)
  await gate(f.args)
  assert.equal(f.outputs.current, 'false')
  assert.deepEqual(f.requests, [])
})
test('branch advancing during CI wait prevents deployment', async () => {
  const f = fixture()
  f.setRuns([{ ...f.source, status: 'in_progress' }])
  f.args.sleep = async () => {
    f.setBranch(otherSha)
    f.setRuns([{ ...f.source, status: 'completed' }])
  }
  await gate(f.args)
  assert.equal(f.outputs.current, 'false')
})
test('running CI is awaited before reporting success', async () => {
  const f = fixture()
  f.setRuns([])
  f.args.sleep = async () => {
    f.setRuns([{ ...f.source, status: 'completed' }])
  }
  await gate(f.args)
  assert.equal(f.outputs.current, 'true')
  assert.equal(f.requests.length, 2)
})

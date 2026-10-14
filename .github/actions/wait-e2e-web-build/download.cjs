const { execFile } = require('node:child_process')
const { appendFile, mkdtemp, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const waitForBuild = require('./wait.cjs')

const execFileAsync = promisify(execFile)

async function downloadWebBuild({
  env = process.env,
  execute = execFileAsync,
  webDir = path.resolve(__dirname, '../../../web'),
} = {}) {
  const repository = env.GITHUB_REPOSITORY
  const runId = env.GITHUB_RUN_ID
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT)
  if (
    !repository ||
    !/^\d+$/.test(runId || '') ||
    !Number.isInteger(runAttempt) ||
    runAttempt < 1 ||
    !env.GH_TOKEN
  ) {
    throw new Error(
      'Downloading the Web build requires GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, and GH_TOKEN.',
    )
  }

  const run = (command, args, timeout = 60_000) =>
    execute(command, args, {
      env,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
    })
  const api = async (endpoint, paginate = false) => {
    const { stdout } = await run('gh', [
      'api',
      endpoint,
      ...(paginate ? ['--paginate', '--slurp'] : []),
    ])
    return JSON.parse(stdout)
  }
  const prefix = `repos/${repository}/actions`
  let summary = ''
  const artifactId = await waitForBuild({
    github: {
      rest: {
        actions: { listJobsForWorkflowRunAttempt: 'jobs', listWorkflowRunArtifacts: 'artifacts' },
      },
      paginate: async (kind) => {
        const endpoint =
          kind === 'jobs'
            ? `${prefix}/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`
            : `${prefix}/runs/${runId}/artifacts?per_page=100`
        const pages = await api(endpoint, true)
        return pages.flatMap((page) => page[kind])
      },
    },
    context: { repo: {}, runId },
    core: {
      info: console.log,
      summary: {
        addHeading(text) {
          summary += `### ${text}\n\n`
          return this
        },
        addRaw(text) {
          summary += `${text}\n`
          return this
        },
        async write() {
          if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary)
        },
      },
    },
    runAttempt,
  })

  const artifact = await api(`${prefix}/artifacts/${artifactId}`)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dify-e2e-web-build-'))
  try {
    // Artifact names are immutable within a run. Use the name selected by wait.cjs,
    // including its matching upload timestamp when only consumer jobs are rerun.
    await run(
      'gh',
      ['run', 'download', runId, '--repo', repository, '--name', artifact.name, '--dir', directory],
      300_000,
    )
    await run('tar', ['-xf', path.join(directory, 'e2e-web-build.tar'), '-C', webDir])
    console.log(`Web build artifact ${artifactId} extracted and ready.`)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

module.exports = downloadWebBuild

if (require.main === module) {
  downloadWebBuild().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

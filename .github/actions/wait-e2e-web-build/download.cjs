const { execFile } = require('node:child_process')
const { appendFile, mkdtemp, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { promisify } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')
const waitForBuild = require('./wait.cjs')

const execFileAsync = promisify(execFile)

async function downloadWebBuild({
  env = process.env,
  execute = execFileAsync,
  sleep = delay,
  webDir = path.resolve(__dirname, '../../../web'),
  sleep = delay,
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
    const retryDelays = [2000, 5000, 10000]
    for (let attempt = 0; ; attempt++) {
      try {
        const { stdout } = await run('gh', [
          'api',
          endpoint,
          ...(paginate ? ['--paginate', '--slurp'] : []),
        ])
        return JSON.parse(stdout)
      } catch (error) {
        if (attempt >= retryDelays.length || !/\bHTTP (?:429|5\d\d)\b/.test(error.stderr || '')) throw error
        console.warn(`GitHub API temporarily unavailable; retrying in ${retryDelays[attempt]}ms`)
        await sleep(retryDelays[attempt])
      }
    }
  }
  // An artifact can be listed for the run before its own endpoint and download are
  // readable (seen as a 404 right after upload), so retry those reads briefly.
  const withRetry = async (operation) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await operation()
      } catch (error) {
        if (attempt >= 3) throw error
        console.log(`Web build artifact not readable yet (attempt ${attempt}): ${error.message}`)
        await sleep(attempt * 5_000)
      }
    }
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

  const artifact = await withRetry(() => api(`${prefix}/artifacts/${artifactId}`))
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dify-e2e-web-build-'))
  try {
    // Artifact names are immutable within a run. Use the name selected by wait.cjs,
    // including its matching upload timestamp when only consumer jobs are rerun.
    await withRetry(() =>
      run(
        'gh',
        [
          'run',
          'download',
          runId,
          '--repo',
          repository,
          '--name',
          artifact.name,
          '--dir',
          directory,
        ],
        300_000,
      ),
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

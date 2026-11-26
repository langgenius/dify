const { execFile } = require('node:child_process')
const { appendFile, mkdtemp, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { promisify } = require('node:util')
const waitForBuild = require('./wait.cjs')

const execFileAsync = promisify(execFile)

async function downloadWebBuild({
  env = process.env,
  execute = execFileAsync,
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
  const list = async (endpoint) => {
    const args = ['api', endpoint, '--paginate', '--slurp']
    const { stdout } = await run('gh', args).catch((error) => {
      if (error.code !== 1 || error.stderr?.trim() !== 'unexpected end of JSON input') throw error
      // An incomplete page makes gh exit before it can return a usable listing.
      console.log(`Retrying GitHub Actions metadata request after incomplete JSON: ${endpoint}`)
      return run('gh', args)
    })
    return JSON.parse(stdout)
  }
  const prefix = `repos/${repository}/actions`
  let summary = ''
  const artifact = await waitForBuild({
    github: {
      rest: {
        actions: { listJobsForWorkflowRunAttempt: 'jobs', listWorkflowRunArtifacts: 'artifacts' },
      },
      paginate: async (kind) => {
        const endpoint =
          kind === 'jobs'
            ? `${prefix}/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`
            : `${prefix}/runs/${runId}/artifacts?per_page=100`
        const pages = await list(endpoint)
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

  const directory = await mkdtemp(path.join(os.tmpdir(), 'dify-e2e-web-build-'))
  try {
    // The run's artifact list already provides the immutable name. The separate
    // metadata endpoint can return 404 after the artifact has appeared in that list.
    // The archive can also take a moment to become readable after upload.
    const downloadArgs = [
      'run',
      'download',
      runId,
      '--repo',
      repository,
      '--name',
      artifact.name,
      '--dir',
      directory,
    ]
    for (let attempt = 1; ; attempt++) {
      try {
        await run('gh', downloadArgs, 300_000)
        break
      } catch (error) {
        if (attempt >= 3) throw error
        console.log(`Web build artifact not readable yet (attempt ${attempt}): ${error.message}`)
        await sleep(attempt * 5_000)
      }
    }
    await run('tar', ['-xf', path.join(directory, 'e2e-web-build.tar'), '-C', webDir])
    console.log(`Web build artifact ${artifact.id} extracted and ready.`)
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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vite-plus/test'

const WORKFLOW_PATH = fileURLToPath(
  new URL('../../.github/workflows/cli-release.yml', import.meta.url),
)

const JOB_RELEASE = 'release'

const STEP_COMPILE = 'Compile standalone binaries (all targets)'
const STEP_CHECKSUMS = 'Generate sha256 checksum file'

const DRY_RUN_GUARDED_STEPS = [
  'Attach difyctl assets to Dify release',
  'Prune stale difyctl assets',
]

const TRIGGER_INPUTS = ['release_tag', 'dry_run']

type WorkflowInput = {
  description?: string
  required?: boolean
  type?: string
  default?: unknown
}

type Triggers = {
  workflow_dispatch?: { inputs?: Record<string, WorkflowInput> }
  workflow_call?: { inputs?: Record<string, WorkflowInput> }
  release?: { types?: string[] }
}

type Step = {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  env?: Record<string, string>
}

type Job = {
  name?: string
  if?: string
  needs?: string | string[]
  outputs?: Record<string, string>
  env?: Record<string, string>
  steps?: Step[]
}

type Workflow = {
  triggers: Triggers
  jobs: Record<string, Job>
}

function parseWorkflow(): Workflow {
  const raw: unknown = load(readFileSync(WORKFLOW_PATH, 'utf8'))
  if (raw === null || typeof raw !== 'object')
    throw new Error(`${WORKFLOW_PATH} did not parse to a mapping`)
  const doc = raw as Record<string, unknown>
  const triggers = (doc.on ?? doc.true) as Triggers | undefined
  if (triggers === undefined || typeof triggers !== 'object')
    throw new Error(`${WORKFLOW_PATH}: no trigger block under \`on:\` or boolean-true \`on\``)
  const jobs = doc.jobs as Record<string, Job> | undefined
  if (jobs === undefined) throw new Error(`${WORKFLOW_PATH}: no \`jobs:\` block`)
  return { triggers, jobs }
}

const workflow = parseWorkflow()

function job(name: string): Job {
  const found = workflow.jobs[name]
  if (found === undefined)
    throw new Error(`no job named "${name}" (have: ${Object.keys(workflow.jobs).join(', ')})`)
  return found
}

function stepsOf(jobName: string): Step[] {
  const steps = job(jobName).steps
  if (steps === undefined || steps.length === 0) throw new Error(`job "${jobName}" has no steps`)
  return steps
}

function findStep(steps: readonly Step[], name: string): Step {
  const step = steps.find((s) => s.name === name)
  if (step === undefined) {
    const have = steps.map((s) => s.name ?? '(unnamed)').join(' | ')
    throw new Error(`no step named "${name}" (have: ${have})`)
  }
  return step
}

const allSteps = (): Step[] => Object.keys(workflow.jobs).flatMap((name) => stepsOf(name))

describe('cli-release.yml build step passes CLI_VERSION', () => {
  it('passes CLI_VERSION into the compile step run body', () => {
    const step = findStep(stepsOf(JOB_RELEASE), STEP_COMPILE)
    expect(step.run ?? '').toContain('CLI_VERSION=')
  })
})

describe('cli-release.yml dry_run guards', () => {
  it('guards exactly the steps that touch the outside world', () => {
    const guarded = allSteps()
      .filter((s) => s.if?.includes('dry_run') === true)
      .map((s) => s.name)
    expect(guarded).toStrictEqual(DRY_RUN_GUARDED_STEPS)
  })

  it('leaves the build and checksum steps unguarded', () => {
    const steps = stepsOf(JOB_RELEASE)
    expect(findStep(steps, STEP_COMPILE).if).toBeUndefined()
    expect(findStep(steps, STEP_CHECKSUMS).if).toBeUndefined()
  })
})

describe('cli-release.yml duplicate-version gate stays deleted', () => {
  it('has no step rejecting a duplicate difyctl version', () => {
    const names = allSteps().map((s) => s.name ?? '')
    expect(names).not.toContain('Reject duplicate difyctl version')
    expect(names.filter((n) => /duplicate/i.test(n))).toStrictEqual([])
  })
})

describe('cli-release.yml creates no git tag', () => {
  it('has no provenance-tag step', () => {
    const names = allSteps().map((s) => s.name ?? '')
    expect(names.filter((n) => /tag/i.test(n))).toStrictEqual([])
  })

  it('posts to no git-refs endpoint', () => {
    const runBodies = allSteps()
      .map((s) => s.run ?? '')
      .join('\n')
    expect(runBodies).not.toContain('git/refs')
  })
})

describe('cli-release.yml trigger contract', () => {
  const dispatchInputs = workflow.triggers.workflow_dispatch?.inputs ?? {}
  const callInputs = workflow.triggers.workflow_call?.inputs ?? {}

  it.each([
    ['workflow_dispatch', dispatchInputs],
    ['workflow_call', callInputs],
  ])('declares the release inputs on %s', (_trigger, inputs) => {
    for (const name of TRIGGER_INPUTS) expect(Object.keys(inputs)).toContain(name)
    expect(inputs.dry_run?.type).toBe('boolean')
  })

  it('keeps the two duplicated input blocks in sync', () => {
    expect(Object.keys(dispatchInputs).sort()).toStrictEqual(Object.keys(callInputs).sort())
  })

  it('auto-triggers only on a published non-pre-release', () => {
    expect(workflow.triggers.release?.types).toStrictEqual(['released'])
  })
})

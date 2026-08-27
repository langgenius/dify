import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vite-plus/test'

// cli-release.yml is the only part of the release path with no other test
// harness, and its two failure modes (a build step that stops passing
// CLI_VERSION, a compat gate that stops being conditional) both review clean
// while doing the wrong thing — they only surface on a live Dify release.
const WORKFLOW_PATH = fileURLToPath(
  new URL('../../.github/workflows/cli-release.yml', import.meta.url),
)

const JOB_VALIDATE = 'validate'
const JOB_RELEASE = 'release'

const STEP_DERIVE = 'Derive difyctl version'
const STEP_COMPAT = 'Compatibility check'
const STEP_COMPILE = 'Compile standalone binaries (all targets)'
const STEP_CHECKSUMS = 'Generate sha256 checksum file'

// The steps that touch the outside world, and the only ones dry_run skips.
const DRY_RUN_GUARDED_STEPS = [
  'Attach difyctl assets to Dify release',
  'Prune stale difyctl assets',
]

const SHOULD_RELEASE = 'should_release'
const VALIDATE_OUTPUTS = [SHOULD_RELEASE, 'difyctl_version', 'dify_tag']
const TRIGGER_INPUTS = ['release_tag', 'difyctl_version', 'dry_run']

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

// A YAML 1.1 loader resolves the bare key `on` to boolean true and keys the
// trigger block under `true`; js-yaml 5 is YAML 1.2 and keys it under 'on'.
// Accept either and throw when neither is present, so a loader swap cannot
// turn every trigger assertion into a vacuous pass on an undefined lookup.
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

function findStep(steps: readonly Step[], name: string): { index: number; step: Step } {
  const index = steps.findIndex((s) => s.name === name)
  const step = steps[index]
  if (step === undefined) {
    const have = steps.map((s) => s.name ?? '(unnamed)').join(' | ')
    throw new Error(`no step named "${name}" (have: ${have})`)
  }
  return { index, step }
}

const allSteps = (): Step[] => Object.keys(workflow.jobs).flatMap((name) => stepsOf(name))

describe('cli-release.yml build step passes CLI_VERSION', () => {
  it('passes CLI_VERSION into the compile step run body', () => {
    // Trap 1: this step used to pass no CLI_VERSION at all and relied on a
    // package.json fallback inside release-build.sh. That fallback is deleted
    // and CLI_VERSION is now required, so dropping the assignment breaks the
    // release — on a live Dify release, with nothing else exercising it.
    const { step } = findStep(stepsOf(JOB_RELEASE), STEP_COMPILE)
    expect(step.run ?? '').toContain('CLI_VERSION=')
  })

  it('wires the job-level CLI_VERSION to the derived version', () => {
    expect(job(JOB_RELEASE).env?.CLI_VERSION ?? '').toContain(
      `needs.${JOB_VALIDATE}.outputs.difyctl_version`,
    )
  })
})

describe('cli-release.yml compat gate is conditional', () => {
  it('guards the compat check on the derive step should_release output', () => {
    // Trap 2: Actions steps run regardless of an earlier step's outputs, and
    // derive-version exits 0 on a shape mismatch. Every real non-X.Y.Z Dify tag
    // also sits outside the one-minor-wide compat window, so without this `if:`
    // the skip behaviour never fires for any real tag — the shape gate would be
    // present in the file and the red X would happen anyway.
    const steps = stepsOf(JOB_VALIDATE)
    const derive = findStep(steps, STEP_DERIVE)
    const compat = findStep(steps, STEP_COMPAT)
    expect(derive.step.id).toBeTypeOf('string')
    expect(compat.step.if ?? '').toContain(`steps.${derive.step.id}.outputs.${SHOULD_RELEASE}`)
  })

  it('places the compat check after the derive step', () => {
    const steps = stepsOf(JOB_VALIDATE)
    expect(findStep(steps, STEP_COMPAT).index).toBeGreaterThan(findStep(steps, STEP_DERIVE).index)
  })
})

describe('cli-release.yml skip wiring', () => {
  it('gates the release job on the validate should_release output', () => {
    const release = job(JOB_RELEASE)
    expect(release.needs).toContain(JOB_VALIDATE)
    expect(release.if ?? '').toContain(`needs.${JOB_VALIDATE}.outputs.${SHOULD_RELEASE} == 'true'`)
  })

  it('exposes every output the release job consumes', () => {
    const outputs = job(JOB_VALIDATE).outputs ?? {}
    for (const name of VALIDATE_OUTPUTS) {
      expect(Object.keys(outputs)).toContain(name)
      expect(outputs[name]).toBeTruthy()
    }
  })
})

describe('cli-release.yml dry_run guards', () => {
  it('guards exactly the three steps that touch the outside world', () => {
    const guarded = allSteps()
      .filter((s) => s.if?.includes('dry_run') === true)
      .map((s) => s.name)
    expect(guarded).toStrictEqual(DRY_RUN_GUARDED_STEPS)
  })

  it('leaves the build and checksum steps unguarded', () => {
    // The whole point of dry_run is that the cross-compile and the checksum file
    // still run: four of the five things that can only fail in anger are cheap
    // to exercise without touching a release.
    const steps = stepsOf(JOB_RELEASE)
    expect(findStep(steps, STEP_COMPILE).step.if).toBeUndefined()
    expect(findStep(steps, STEP_CHECKSUMS).step.if).toBeUndefined()
  })
})

describe('cli-release.yml duplicate-version gate stays deleted', () => {
  it('has no step rejecting a duplicate difyctl version', () => {
    const names = allSteps().map((s) => s.name ?? '')
    expect(names).not.toContain('Reject duplicate difyctl version')
    expect(names.filter((n) => /duplicate/i.test(n))).toStrictEqual([])
  })
})

// The step this guards against looked harmless and ran green for four releases while
// never once working: repository ruleset 1715221 blocks `creation` on `~ALL` tags with
// no bypass actor, so every POST was rejected and the handler misread the rejection as
// "tag already exists". Verified 2026-08-26 — zero difyctl-v* tags exist. Re-adding tag
// creation needs a ruleset bypass first, or it silently does nothing again.
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

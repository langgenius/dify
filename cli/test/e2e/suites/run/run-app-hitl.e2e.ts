/**
 * E2E: difyctl run app + difyctl resume app — HITL human-in-the-loop specialisation
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Run/HITL Human Intervention (19 cases)
 *
 * Prerequisites:
 *   DIFY_E2E_HITL_APP_ID — workflow app containing a Human Input node with display_in_ui=true
 *   All HITL cases are skipped when this variable is not configured.
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, inject, it } from 'vitest'
import { assertExitCode, assertJson, assertNonZeroExit, assertStderrContains } from '../../helpers/assert.js'
import { run, withAuthFixture } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalDescribe } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

const describeSuite = optionalDescribe(Boolean(E.hitlAppId))

describeSuite('E2E / difyctl run app — HITL human intervention', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P0] workflow HITL pause outputs a pause block on stdout — exit code 0', async () => {
    // Spec 4.5.1/4.5.2: stdout contains pause block with Node name + Actions list; exit 0.
    const result = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'hitl-e2e' }),
    ])
    assertExitCode(result, 0)
    // pause block must be present
    expect(result.stdout).toMatch(/paused|pause/i)
    // actions list rendered in stdout
    expect(result.stdout).toMatch(/action|button/i)
  })

  it('[P0] HITL pause JSON contains all required fields', async () => {
    // Spec 4.5.3/4.5.4/4.5.5: JSON envelope must include the full set of fields.
    const result = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'hitl-json' }),
      '-o',
      'json',
    ])
    assertExitCode(result, 0)
    const p = assertJson<Record<string, unknown>>(result)
    // core status
    expect(p).toHaveProperty('status', 'paused')
    // identity fields
    expect(p).toHaveProperty('app_id')
    expect(p).toHaveProperty('task_id')
    expect(p).toHaveProperty('workflow_run_id')
    expect(p).toHaveProperty('form_id')
    expect(p).toHaveProperty('node_id')
    // display fields
    expect(p).toHaveProperty('node_title')
    expect(p).toHaveProperty('form_content')
    expect(p).toHaveProperty('inputs')
    expect(p).toHaveProperty('actions')
    expect(p).toHaveProperty('display_in_ui')
    expect(p).toHaveProperty('resolved_default_values')
    // token + expiry
    expect(p).toHaveProperty('form_token')
    expect(typeof p.form_token).toBe('string')
    expect((p.form_token as string).length).toBeGreaterThan(0)
    expect(p).toHaveProperty('expiration_time')
    expect(typeof p.expiration_time).toBe('number')
    expect(p.expiration_time as number).toBeGreaterThan(0)
  })

  it('[P0] HITL pause hint contains the full resume command', async () => {
    // Spec 4.5.6: stderr hint must be a directly executable resume command including
    // the app id, form_token, and --workflow-run-id flag.
    const pauseResult = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'hint-test' }),
      '-o',
      'json',
    ])
    assertExitCode(pauseResult, 0)
    const { form_token, workflow_run_id } = assertJson<{ form_token: string, workflow_run_id: string }>(pauseResult)
    // hint must contain all three identifiers
    assertStderrContains(pauseResult, 'difyctl resume app')
    assertStderrContains(pauseResult, '--workflow-run-id')
    assertStderrContains(pauseResult, form_token)
    assertStderrContains(pauseResult, workflow_run_id)
  })

  it('[P0] AI Agent automation — extract form_token from JSON and auto-resume', async () => {
    // Spec 4.5.11/4.5.13/4.5.19: run → extract form_token → resume with --action and
    // --inputs; final output must reflect workflow_finished (exit 0).
    const pauseResult = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'auto-resume' }),
      '-o',
      'json',
    ])
    assertExitCode(pauseResult, 0)
    const envelope = assertJson<{
      form_token: string
      workflow_run_id: string
      app_id?: string
      actions?: Array<{ id: string }>
    }>(pauseResult)
    expect(envelope.form_token).toBeTruthy()
    expect(envelope.workflow_run_id).toBeTruthy()

    // Step 2: resume with explicit --action and --inputs (Spec 4.5.11)
    const actionId = envelope.actions?.[0]?.id ?? 'action_1'
    const resumeResult = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      envelope.form_token,
      '--workflow-run-id',
      envelope.workflow_run_id,
      '--action',
      actionId,
      '--inputs',
      JSON.stringify({ name: 'E2E-auto-resume' }),
    ])
    assertExitCode(resumeResult, 0)
    // Spec 4.5.13: final output must signal workflow completion
    expect(resumeResult.stdout + resumeResult.stderr)
      .toMatch(/succeeded|finished|workflow_finished|completed/i)
  })

  it('[P0] resume app auto-selects the single action — workflow continues execution', async () => {
    // Spec 4.5.9: when the form has exactly one action, --action may be omitted
    // and the CLI auto-selects it.
    // Uses hitlSingleActionAppId (display_in_ui=true, 1 action, no required inputs).
    // hitlAppId now has 3 actions so it cannot be used here.
    if (!E.hitlSingleActionAppId)
      return

    const pause = await fx.r([
      'run',
      'app',
      E.hitlSingleActionAppId,
      '-o',
      'json',
    ])
    assertExitCode(pause, 0)
    const { form_token, workflow_run_id, actions } = assertJson<{
      form_token: string
      workflow_run_id: string
      actions: Array<{ id: string }>
    }>(pause)
    expect(actions.length, 'fixture must have exactly 1 action').toBe(1)

    // Resume without --action — CLI auto-selects the only available action.
    const resume = await fx.r([
      'resume',
      'app',
      E.hitlSingleActionAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
    ])
    assertExitCode(resume, 0)
  })

  // ── New cases ────────────────────────────────────────────────────────────

  it('[P0] HITL pause in streaming mode outputs pause block (4.5.7)', async () => {
    // Spec 4.5.7: --stream mode must still emit pause block and exit 0 on HITL.
    // Streaming HITL: SSE connection can be closed unexpectedly;
    // withRetry triggers on thrown errors so we throw when exit != 0.
    const result = await withRetry(async () => {
      const r = await run(
        ['run', 'app', E.hitlAppId, '--inputs', JSON.stringify({ x: 'hitl-stream' }), '--stream'],
        { configDir: fx.configDir, timeout: 60_000 },
      )
      if (r.exitCode !== 0)
        throw new Error(`streaming HITL exited ${r.exitCode}: ${r.stderr.slice(0, 200)}`)
      return r
    }, { attempts: 3, delayMs: 3000 })
    assertExitCode(result, 0)
    expect(result.stdout + result.stderr).toMatch(/paused|pause|resume/i)
  })

  it('[P0] resume with already-consumed form_token returns error (4.5.16)', async () => {
    // Spec 4.5.16: once a form_token has been consumed by a successful resume,
    // submitting the same token again must return an error with exit code non-zero.
    const pause = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'double-resume' }),
      '-o',
      'json',
    ])
    assertExitCode(pause, 0)
    const { form_token, workflow_run_id, actions } = assertJson<{
      form_token: string
      workflow_run_id: string
      actions?: Array<{ id: string }>
    }>(pause)
    const actionId = actions?.[0]?.id ?? 'action_1'

    // First resume — must succeed
    const first = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
      '--action',
      actionId,
    ])
    assertExitCode(first, 0)

    // Second resume with the same token — must fail
    const second = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
      '--action',
      actionId,
    ])
    assertNonZeroExit(second)
  })

  it('[P1] resume with --inputs-file reads form values from JSON file (4.5.12)', async () => {
    // Spec 4.5.12: --inputs-file must read form field values from a local JSON file.
    const pause = await withRetry(async () => {
      const r = await fx.r([
        'run',
        'app',
        E.hitlAppId,
        '--inputs',
        JSON.stringify({ x: 'inputs-file-test' }),
        '-o',
        'json',
      ])
      assertExitCode(r, 0)
      return r
    }, { attempts: 3, delayMs: 2000 })
    const { form_token, workflow_run_id, actions } = assertJson<{
      form_token: string
      workflow_run_id: string
      actions?: Array<{ id: string }>
    }>(pause)
    const actionId = actions?.[0]?.id ?? 'action_1'

    // Write form values to a temp file
    const inputsFile = join(tmpdir(), `hitl-e2e-${Date.now()}.json`)
    await writeFile(inputsFile, JSON.stringify({ name: 'E2E-inputs-file' }))

    const result = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
      '--action',
      actionId,
      '--inputs-file',
      inputsFile,
    ])
    assertExitCode(result, 0)
  })

  it('[P1] resume with --with-history returns node history in output (4.5.14)', async () => {
    // Spec 4.5.14: --with-history must request include_state_snapshot=true and
    // return historical node events; the CLI must exit 0 with non-empty output.
    const pause = await withRetry(async () => {
      const r = await fx.r([
        'run',
        'app',
        E.hitlAppId,
        '--inputs',
        JSON.stringify({ x: 'with-history-test' }),
        '-o',
        'json',
      ])
      assertExitCode(r, 0)
      return r
    }, { attempts: 3, delayMs: 2000 })
    const { form_token, workflow_run_id, actions } = assertJson<{
      form_token: string
      workflow_run_id: string
      actions?: Array<{ id: string }>
    }>(pause)
    const actionId = actions?.[0]?.id ?? 'action_1'

    const result = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
      '--action',
      actionId,
      '--with-history',
    ])
    assertExitCode(result, 0)
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0)
  })

  it('[P1] resume with --stream outputs workflow completion in real-time (4.5.17)', async () => {
    // Spec 4.5.17: resume --stream must stream continuation node outputs to stdout
    // and exit 0 after workflow_finished.
    const pause = await withRetry(async () => {
      const r = await fx.r([
        'run',
        'app',
        E.hitlAppId,
        '--inputs',
        JSON.stringify({ x: 'resume-stream-test' }),
        '-o',
        'json',
      ])
      assertExitCode(r, 0)
      return r
    }, { attempts: 3, delayMs: 2000 })
    const { form_token, workflow_run_id, actions } = assertJson<{
      form_token: string
      workflow_run_id: string
      actions?: Array<{ id: string }>
    }>(pause)
    const actionId = actions?.[0]?.id ?? 'action_1'

    const result = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
      '--action',
      actionId,
      '--stream',
    ])
    assertExitCode(result, 0)
  })
})

// ── 4.5.8  display_in_ui=false — HITL pause with external channel delivery ──────
//
// A separate describe block so the suite can be skipped independently when
// DIFY_E2E_HITL_EXTERNAL_APP_ID is not configured.

const describeExternal = optionalDescribe(Boolean(E.hitlExternalAppId))

describeExternal('E2E / difyctl run app — HITL display_in_ui=false (4.5.8)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P1] 4.5.8 HITL pause with display_in_ui=false: external-channel form is not CLI-resumable', async () => {
    const result = await fx.r([
      'run',
      'app',
      E.hitlExternalAppId,
      '-o',
      'json',
    ])
    assertExitCode(result, 0)

    const parsed = assertJson<{
      status: string
      display_in_ui: boolean
      form_token: string | null
      approval_channels: string[]
      workflow_run_id: string
    }>(result)

    // display_in_ui must be false for this fixture
    expect(parsed.display_in_ui, 'display_in_ui must be false for external-channel fixture').toBe(false)

    // status must be paused
    expect(parsed.status).toBe('paused')

    // external delivery is not CLI-resumable: no token, channels name the real route
    expect(parsed.form_token, 'form_token must be null for external delivery').toBeNull()
    expect(parsed.approval_channels, 'approval_channels must name the delivery channel').toContain('email')

    // stderr hint must describe the channel, not offer a resume command
    expect(result.stderr).toMatch(/delivered via|resume only from/i)
    expect(result.stderr).not.toMatch(/difyctl resume/i)
  })
})

// ── 4.5.10  multiple actions — resume without --action returns error ──────────
//
// The existing DIFY_E2E_HITL_APP_ID fixture now has 3 actions (action_1/2/3).
// When --action is omitted and the form has multiple actions, the CLI must
// return "--action required: form has multiple user actions" with exit 1.

const describeMultiAction = optionalDescribe(Boolean(E.hitlAppId))

describeMultiAction('E2E / difyctl resume app — HITL multiple actions (4.5.10)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P0] 4.5.10 resume without --action when form has multiple actions returns exit 1', async () => {
    // Spec 4.5.10: when the HITL form has multiple user actions and --action is
    // not provided, the CLI must reject the command with a clear error.
    //
    // Step 1: trigger the HITL pause and extract form_token + workflow_run_id.
    const runResult = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'multi-action-test' }),
      '-o',
      'json',
    ])
    assertExitCode(runResult, 0)
    const { form_token, workflow_run_id, actions } = assertJson<{
      form_token: string
      workflow_run_id: string
      actions: Array<{ id: string }>
    }>(runResult)

    // Confirm the fixture has more than one action.
    expect(actions.length, 'fixture must have multiple actions for this test').toBeGreaterThan(1)

    // Step 2: attempt to resume without --action.
    const resumeResult = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
      // intentionally omit --action
    ])

    expect(resumeResult.exitCode, 'omitting --action with multiple actions must exit non-zero').toBe(1)
    expect(resumeResult.stderr).toMatch(/--action required|multiple.*action|action.*required/i)
  })
})

// ── 4.5.18  2 serial HITL nodes — run → resume → resume → finished ────────────
//
// Prerequisite: DIFY_E2E_HITL_MULTI_NODE_APP_ID must be set.
// The fixture app has 2 serial Human Input nodes, each with 1 action.
// Flow: run → pause at node 1 → resume 1 → pause at node 2 → resume 2 → finished.

const describeMultiNode = optionalDescribe(Boolean(E.hitlMultiNodeAppId))

describeMultiNode('E2E / difyctl run + resume — HITL 2 serial nodes (4.5.18)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P1] 4.5.18 workflow with 2 serial HITL nodes completes after two resumes', async () => {
    // Spec 4.5.18: run → resume(node1) → resume(node2) → workflow_finished.
    // Both resumes must succeed; final output must indicate success.

    // ── Step 1: run — pauses at first HITL node ──────────────────────────
    const pause1 = await withRetry(async () => {
      const r = await fx.r([
        'run',
        'app',
        E.hitlMultiNodeAppId,
        '-o',
        'json',
      ])
      if (r.exitCode !== 0)
        throw new Error(`run failed: ${r.stderr.slice(0, 200)}`)
      return r
    }, { attempts: 3, delayMs: 3000 })

    assertExitCode(pause1, 0)
    const node1 = assertJson<{
      status: string
      form_token: string
      workflow_run_id: string
      actions: Array<{ id: string }>
    }>(pause1)
    expect(node1.status).toBe('paused')
    expect(node1.form_token, 'node 1 must return a form_token').toBeTruthy()

    const actionId1 = node1.actions[0]?.id ?? 'action_1'

    // ── Step 2: resume node 1 — workflow continues to second HITL node ───
    const pause2 = await withRetry(async () => {
      const r = await fx.r([
        'resume',
        'app',
        E.hitlMultiNodeAppId,
        node1.form_token,
        '--workflow-run-id',
        node1.workflow_run_id,
        '--action',
        actionId1,
        '-o',
        'json',
      ])
      if (r.exitCode !== 0)
        throw new Error(`resume 1 failed: ${r.stderr.slice(0, 200)}`)
      return r
    }, { attempts: 3, delayMs: 3000 })

    assertExitCode(pause2, 0)
    const node2 = assertJson<{
      status: string
      form_token: string
      workflow_run_id: string
      actions: Array<{ id: string }>
    }>(pause2)
    expect(node2.status, 'after first resume the workflow must pause again at node 2').toBe('paused')
    expect(node2.form_token, 'node 2 must return a new form_token').toBeTruthy()
    expect(node2.form_token, 'node 2 form_token must differ from node 1').not.toBe(node1.form_token)

    const actionId2 = node2.actions[0]?.id ?? 'action_1'

    // ── Step 3: resume node 2 — workflow finishes ─────────────────────────
    const finish = await withRetry(async () => {
      const r = await fx.r([
        'resume',
        'app',
        E.hitlMultiNodeAppId,
        node2.form_token,
        '--workflow-run-id',
        node2.workflow_run_id,
        '--action',
        actionId2,
      ])
      if (r.exitCode !== 0)
        throw new Error(`resume 2 failed: ${r.stderr.slice(0, 200)}`)
      return r
    }, { attempts: 3, delayMs: 3000 })

    assertExitCode(finish, 0)
    expect(finish.stdout + finish.stderr).toMatch(/succeeded|finished/i)
  })
})

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
import { afterEach, beforeEach, expect, it } from 'vitest'
import { assertExitCode, assertJson, assertNonZeroExit, assertStderrContains } from '../../helpers/assert.js'
import { withAuthFixture } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalDescribe } from '../../helpers/skip.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

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
    // Spec: resume app auto-selects the single action without requiring --action
    const pause = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'auto-action' }),
      '-o',
      'json',
    ])
    assertExitCode(pause, 0)
    const { form_token, workflow_run_id } = assertJson<{ form_token: string, workflow_run_id: string }>(pause)
    // Resume without --action (single action auto-selected)
    const resume = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      form_token,
      '--workflow-run-id',
      workflow_run_id,
    ])
    assertExitCode(resume, 0)
  })

  // ── New cases ────────────────────────────────────────────────────────────

  it('[P0] HITL pause in streaming mode outputs pause block (4.5.7)', async () => {
    // Spec 4.5.7: --stream mode must still emit pause block and exit 0 on HITL.
    const result = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'hitl-stream' }),
      '--stream',
    ])
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

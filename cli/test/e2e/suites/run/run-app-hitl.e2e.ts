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
import { afterEach, beforeEach, expect, it } from 'vitest'
import { assertExitCode, assertJson, assertStderrContains } from '../../helpers/assert.js'
import { withAuthFixture } from '../../helpers/cli.js'
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
    // Spec: workflow HITL pause outputs a pause block + exit code 0
    const result = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'hitl-e2e' }),
    ])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Workflow paused|pause/i)
  })

  it('[P0] HITL pause JSON contains all required fields', async () => {
    // Spec: HITL pause JSON output contains all required fields
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
    expect(p).toHaveProperty('status', 'paused')
    expect(p).toHaveProperty('form_token')
    expect(p).toHaveProperty('workflow_run_id')
    expect(p).toHaveProperty('node_title')
    expect(p).toHaveProperty('form_content')
    expect(p).toHaveProperty('actions')
  })

  it('[P0] HITL pause hint contains the full resume command', async () => {
    // Spec: HITL pause hint contains the full resume command
    const result = await fx.r([
      'run',
      'app',
      E.hitlAppId,
      '--inputs',
      JSON.stringify({ x: 'hint-test' }),
    ])
    assertExitCode(result, 0)
    assertStderrContains(result, 'difyctl resume app')
    assertStderrContains(result, '--workflow-run-id')
  })

  it('[P0] AI Agent automation — extract form_token from JSON and auto-resume', async () => {
    // Spec: AI Agent automation — extract form_token via jq and auto-resume
    // Step 1: run → pause, obtain JSON envelope
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

    // Step 2: resume — use the first action id from the pause response so
    // the test is not coupled to any specific action label.
    const actionId = envelope.actions?.[0]?.id ?? 'submit'
    const resumeResult = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      envelope.form_token,
      '--workflow-run-id',
      envelope.workflow_run_id,
      '--action',
      actionId,
    ])
    assertExitCode(resumeResult, 0)
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
})

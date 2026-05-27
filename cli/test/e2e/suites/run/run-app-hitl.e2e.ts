/**
 * E2E: difyctl run app + difyctl resume app — HITL 人工介入专项
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/HITL 人工介入（19 条）
 *
 * 前置条件：
 *   DIFY_E2E_HITL_APP_ID — workflow app，包含 Human Input 节点，display_in_ui=true
 *   如果未配置，所有 HITL 用例会被跳过。
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { assertExitCode, assertJson, assertStderrContains } from '../../helpers/assert.js'
import { withAuthFixture } from '../../helpers/cli.js'
import { optionalDescribe } from '../../helpers/skip.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

const describeSuite = optionalDescribe(Boolean(E.hitlAppId))

describeSuite('E2E / difyctl run app — HITL 人工介入', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P0] workflow 触发 HITL 暂停时 stdout 输出 pause block，exit code 为 0', async () => {
    // 文档用例：workflow 触发 HITL 暂停时输出 pause block + exit code 为 0
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

  it('[P0] HITL pause JSON 包含所有必需字段', async () => {
    // 文档用例：HITL pause JSON 输出包含所有必需字段
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

  it('[P0] HITL pause hint 包含完整 resume 命令', async () => {
    // 文档用例：HITL pause 时 hint 包含完整 resume 命令
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

  it('[P0] AI Agent 自动化：从 JSON 提取 form_token，自动 resume', async () => {
    // 文档用例：AI Agent 自动化：jq 提取 form_token 自动 resume
    // Step 1: run → pause，获取 JSON envelope
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
    const envelope = assertJson<{ form_token: string, workflow_run_id: string, app_id?: string }>(pauseResult)
    expect(envelope.form_token).toBeTruthy()
    expect(envelope.workflow_run_id).toBeTruthy()

    // Step 2: resume using extracted tokens
    const resumeResult = await fx.r([
      'resume',
      'app',
      E.hitlAppId,
      envelope.form_token,
      '--workflow-run-id',
      envelope.workflow_run_id,
      '--action',
      'submit',
    ])
    assertExitCode(resumeResult, 0)
  })

  it('[P0] resume app 单 action 时自动选择，workflow 继续执行', async () => {
    // 文档用例：resume app 单 action 时自动选择无需 --action
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

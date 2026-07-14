import type { HitlPauseData, HitlPausePayload } from './sse-collector'
import { describe, expect, it } from 'vitest'
import { buildHitlExitObject, renderHitlHint } from './hitl-render'

function payload(overrides: Partial<HitlPauseData> = {}): HitlPausePayload {
  return {
    event: 'human_input_required',
    task_id: 'task-1',
    workflow_run_id: 'run-1',
    data: {
      form_id: 'form-1',
      node_id: 'node-1',
      node_title: 'Approve',
      form_content: 'Please approve',
      inputs: [],
      actions: [],
      display_in_ui: false,
      form_token: null,
      approval_channels: ['email'],
      resolved_default_values: {},
      expiration_time: 0,
      ...overrides,
    },
  }
}

describe('renderHitlHint — non-resumable form (form_token null)', () => {
  it.each<[string[], string]>([
    [['email'], 'form delivered via email — resume only from that channel'],
    [['console'], 'form delivered via the console — resume only from that channel'],
    [['web_app'], 'form delivered via the web app — resume only from that channel'],
    [
      ['console', 'email'],
      'form delivered via the console or email — resume only from those channels',
    ],
    [[], 'form delivered via another channel — resume only from that channel'],
  ])('renders %j as the channel note', (channels, expected) => {
    const out = renderHitlHint('app-1', payload({ approval_channels: channels }), false)
    expect(out).toBe(`hint: workflow paused — ${expected}\n`)
    expect(out).not.toContain('difyctl resume')
  })

  it('falls back to a generic note when approval_channels is absent (older server)', () => {
    const p = payload()
    delete p.data.approval_channels
    const out = renderHitlHint('app-1', p, false)
    expect(out).toContain('another channel')
  })
})

describe('renderHitlHint — resumable form (form_token present)', () => {
  it('renders the resume command and ignores approval_channels', () => {
    const out = renderHitlHint(
      'app-1',
      payload({ form_token: 'tok-123', approval_channels: [] }),
      false,
    )
    expect(out).toContain('difyctl resume app app-1 tok-123 --workflow-run-id run-1')
    expect(out).not.toContain('delivered via')
  })
})

describe('buildHitlExitObject', () => {
  it('carries approval_channels into the JSON exit object', () => {
    const obj = buildHitlExitObject('app-1', payload({ approval_channels: ['email'] }))
    expect(obj.approval_channels).toEqual(['email'])
    expect(obj.form_token).toBeNull()
  })

  it('defaults approval_channels to [] when absent', () => {
    const p = payload({ form_token: 'tok' })
    delete p.data.approval_channels
    expect(buildHitlExitObject('app-1', p).approval_channels).toEqual([])
  })
})

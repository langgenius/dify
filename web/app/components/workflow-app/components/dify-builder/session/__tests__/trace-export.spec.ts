import type { SessionView } from '../../types'
import type { TraceSnapshot } from '../trace-buffer'
import { buildTraceExport, serializeTraceExport } from '../trace-export'

const snapshot: TraceSnapshot = {
  entries: [
    {
      seq: 1,
      ts: '2026-09-04T00:00:00.000Z',
      dir: 'out',
      kind: 'action',
      payload: { action_id: 'approve_plan' },
    },
    {
      seq: 2,
      ts: '2026-09-04T00:00:01.000Z',
      dir: 'in',
      kind: 'state',
      payload: { state: 'build.plan_approval' },
    },
  ],
  truncated: true,
}

const view = {
  session_id: 's1',
  app_id: 'app-1',
  version: 7,
  state: 'build.plan_approval',
  entry_mode: 'build',
  run_status: 'waiting_input',
  canvas_read_only: false,
  interrupted: false,
  conversation_last_seq: 2,
  model: { provider: 'anthropic', name: 'claude' },
} as unknown as SessionView

describe('buildTraceExport', () => {
  it('assembles meta from the view and counts entries', () => {
    const result = buildTraceExport(snapshot, view)
    expect(result.meta).toMatchObject({
      session_id: 's1',
      app_id: 'app-1',
      entry_mode: 'build',
      state: 'build.plan_approval',
      version: 7,
      entry_count: 2,
      truncated: true,
    })
    expect(result.meta.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(result.trace).toHaveLength(2)
  })

  it('produces safe defaults when there is no view', () => {
    const result = buildTraceExport({ entries: [], truncated: false }, null)
    expect(result.meta).toMatchObject({
      session_id: '',
      app_id: '',
      state: '',
      version: 0,
      entry_count: 0,
      truncated: false,
      model: null,
    })
  })
})

describe('serializeTraceExport', () => {
  it('serializes to pretty JSON', () => {
    const json = serializeTraceExport(buildTraceExport(snapshot, view))
    expect(json).toContain('"entry_count": 2')
    expect(json).toContain('"kind": "action"')
    expect(json).toContain('\n  ') // pretty-printed
  })

  it('does not throw on a circular payload', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const snap: TraceSnapshot = {
      entries: [{ seq: 1, ts: 't', dir: 'in', kind: 'node', payload: circular }],
      truncated: false,
    }
    const json = serializeTraceExport(buildTraceExport(snap, view))
    expect(json).toContain('[Circular]')
  })
})

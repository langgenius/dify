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
      kind: 'command_finished',
      payload: { phase: 'plan', run_status: 'waiting_input' },
    },
  ],
  truncated: true,
}

const view: SessionView = {
  session_id: 's1',
  version: 7,
  phase: 'plan',
  run_status: 'waiting_input',
  canvas_read_only: false,
  interrupted: false,
  conversation_last_seq: 2,
  last_command_id: 'command-1',
  actions: [],
  model: { provider: 'anthropic', name: 'claude' },
}

describe('buildTraceExport', () => {
  it('assembles meta from the view and counts entries', () => {
    const result = buildTraceExport(snapshot, view)
    expect(result.meta).toMatchObject({
      session_id: 's1',
      phase: 'plan',
      run_status: 'waiting_input',
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
      phase: null,
      run_status: null,
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

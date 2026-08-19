// Contracts for the enterprise `workflow-copilot` Fix session API. There is no
// generated contract for this endpoint yet (enterprise-only, still under active
// design), so these mirror the backend's JSON responses by hand until one exists.

export type SessionView = {
  session_id: string
  app_id: string
  version: number
  state: string
  canvas_read_only: boolean
  run_status: string
  interrupted: boolean
  conversation: {
    seq: number
    kind: string
    payload: Record<string, unknown>
    at_version: number
  }[]
}

export type ProgressEntry = {
  id: number
  event: string
  data: unknown
}

// Mirrors the backend's `bizcopilot.ChecklistError` JSON shape exactly (see
// `pkg/enterprise/biz/copilot/models.go`). Used both to seed a checklist-fix
// session (`checklist_errors`) and to report the still-failing items on a
// `recheck` action (`remaining`).
export type ChecklistErrorPayload = {
  node_id: string
  node_type: string
  title: string
  messages: string[]
  unconnected: boolean
  plugin_missing: boolean
}

// The state at which the backend has applied a checklist repair to the draft
// and is waiting for the frontend to re-run its client-side checklist and
// report the result via a `recheck` action. Mirrors `bizcopilot.ChecklistAwaitRecheck`.
export const CHECKLIST_AWAIT_RECHECK_STATE = 'checklist.await_recheck'

// Fire-and-forget actions rendered as generic buttons (no computed payload
// beyond the odd `provide_testdata` special-case in the panel).
export const COPILOT_MANUAL_ACTION_KINDS = [
  'approve_repair',
  'run_verify',
  'provide_testdata',
  'publish',
  'undo',
  're_fix',
] as const

// `recheck` carries a computed `{ passed, remaining }` payload (see
// `ChecklistErrorPayload`) built from the current client-side checklist, so
// it is driven by dedicated panel logic rather than a generic button.
export const COPILOT_ACTION_KINDS = [...COPILOT_MANUAL_ACTION_KINDS, 'recheck'] as const

export type CopilotActionKind = (typeof COPILOT_ACTION_KINDS)[number]

export function isSessionView(value: unknown): value is SessionView {
  if (typeof value !== 'object' || value === null) return false
  return 'session_id' in value && 'version' in value
}

// Parses one `event: <kind>\ndata: <json>` SSE frame (already split on the `\n\n` delimiter).
export function parseSSEFrame(frame: string): { event: string; data: unknown } | null {
  const lines = frame.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  })
  if (dataLines.length === 0) return null
  const raw = dataLines.join('\n')
  let data: unknown = raw
  try {
    data = JSON.parse(raw)
  } catch {
    // not JSON, keep the raw string
  }
  return { event, data }
}

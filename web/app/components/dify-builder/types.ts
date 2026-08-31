// Contracts for the `dify-builder` Build, Edit, and Fix session API. `SessionView` and the
// rest of the wire DTOs are generated from the backend contract — see
// `./contract/types` (AUTO-GENERATED, do not hand-edit). This file contains
// only client-side helpers and values that are not part of that DTO surface.
import type { SessionView } from './contract/types'

export type ProgressEntry = {
  id: number
  event: string
  data: unknown
}

// Mirrors the backend's `bizdifyBuilder.ChecklistError` JSON shape exactly (see
// `pkg/enterprise/biz/difyBuilder/models.go`). Used both to seed a checklist-fix
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
// report the result via a `recheck` action. Mirrors `bizdifyBuilder.ChecklistAwaitRecheck`.
export const CHECKLIST_AWAIT_RECHECK_STATE = 'checklist.await_recheck'

// Fire-and-forget actions rendered as generic buttons (no computed payload
// beyond the odd `provide_testdata` special-case in the panel).
//
// Slice 0 Task 7 made action rendering data-driven off `SessionView.actions`
// (see `use-dify-builder-session.ts`'s `runAction`, now typed to accept any
// backend-provided action id, and `/dify-builder-debug`'s button list).
// This legacy list is retained for protocol-level helpers. The production
// App Builder panel renders `view.actions` directly; new call sites should do
// the same instead of adding ids here.
export const DIFY_BUILDER_MANUAL_ACTION_KINDS = [
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
export const DIFY_BUILDER_ACTION_KINDS = [...DIFY_BUILDER_MANUAL_ACTION_KINDS, 'recheck'] as const

export type DifyBuilderActionKind = (typeof DIFY_BUILDER_ACTION_KINDS)[number]

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

// Contracts for the `dify-builder` Fix session API. `SessionView` and the
// rest of the wire DTOs are generated from the backend contract (Slice 0
// Task 6) — see `./contract/types` (AUTO-GENERATED, do not hand-edit). This
// file re-exports the subset the app consumes plus the SSE/session helpers
// that aren't part of the generated DTO surface (parsing, narrowing, and a
// couple of values that don't come from the backend at all).
// Re-exporting alone (`export type {...} from '...'`) does not bind these
// names locally — `isSessionView` below needs `SessionView` as a local type,
// so this file both imports (for local use) and re-exports (for importers).
import type {
  Action,
  ActionKind,
  AssistantTurnItem,
  CardKind,
  ChangeSetCard,
  ConversationItem,
  DecisionItem,
  NoticeItem,
  Phase,
  RunContextCard,
  RunStatus,
  SessionView,
  SummaryCard,
  TestResultCard,
} from './contract/types'

export type {
  Action,
  ActionKind,
  AssistantTurnItem,
  CardKind,
  ChangeSetCard,
  ConversationItem,
  DecisionItem,
  NoticeItem,
  Phase,
  RunContextCard,
  RunStatus,
  SessionView,
  SummaryCard,
  TestResultCard,
}

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
// This hardcoded list is kept only because the in-editor Dify Builder
// panel (`dify-builder-panel/dify-builder-session-view.tsx`) still renders a
// fixed action list with i18n labels rather than `view.actions`; migrating
// that real (non-throwaway) panel to data-driven actions/labels is out of
// scope here. Don't add new consumers of this list — new call sites should
// use `view.actions` instead.
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

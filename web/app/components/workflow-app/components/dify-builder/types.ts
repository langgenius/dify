// Contracts for the `dify-builder` Build, Edit, and Fix session API are generated
// from the backend OpenAPI document. This file only derives short feature-local
// aliases and owns client-only values.
import type {
  DifyBuilderChecklistErrorPayload,
  DifyBuilderSessionViewResponse,
  Action as GeneratedAction,
  CanvasEventData as GeneratedCanvasEventData,
  FormField as GeneratedFormField,
  SessionModel as GeneratedSessionModel,
} from '@dify/contracts/api/console/dify-builder/types.gen'

export type Action = GeneratedAction
export type CanvasEventData = GeneratedCanvasEventData
export type ChecklistErrorPayload = DifyBuilderChecklistErrorPayload
export type ConversationItem = DifyBuilderSessionViewResponse['conversation'][number]
export type FormField = GeneratedFormField
export type SessionModel = GeneratedSessionModel
export type SessionView = DifyBuilderSessionViewResponse

export type DifyBuilderStreamingTurn = {
  sessionId: string
  turnId: string
  sequence: number
  atVersion: number
  stageId: string
  replyText: string
}

export type DifyBuilderSessionController = {
  startFix: (appId: string, failedRunId: string, modelConfig?: SessionModel) => Promise<boolean>
  startChecklistFix: (
    appId: string,
    checklistErrors: ChecklistErrorPayload[],
    modelConfig?: SessionModel,
  ) => Promise<boolean>
  startBuild: (appId: string, goalText: string, modelConfig?: SessionModel) => Promise<boolean>
  startEdit: (appId: string, goalText: string, modelConfig?: SessionModel) => Promise<boolean>
  refresh: () => Promise<boolean>
  restore: (sessionId: string) => Promise<boolean>
  runAction: (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>
  sendMessage: (text: string) => Promise<boolean>
  updateModel: (modelConfig: SessionModel) => Promise<boolean>
  reset: () => void
}

export type DifyBuilderActionPayloadChange = (
  actionId: string,
  payload: Record<string, unknown>,
) => void
export type DifyBuilderActionValidityChange = (actionId: string, valid: boolean) => void

// The state at which the backend has applied a checklist repair to the draft
// and is waiting for the frontend to re-run its client-side checklist and
// report the result via a `recheck` action. Mirrors `bizdifyBuilder.ChecklistAwaitRecheck`.
export const CHECKLIST_AWAIT_RECHECK_STATE = 'checklist.await_recheck'

// Fire-and-forget actions rendered as generic buttons (no computed payload
// beyond the odd `provide_testdata` special-case in the panel).
//
// Slice 0 Task 7 made action rendering data-driven off `SessionView.actions`
// (see `session/use-session-controller.ts`'s `runAction`, now typed to accept any
// backend-provided action id).
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

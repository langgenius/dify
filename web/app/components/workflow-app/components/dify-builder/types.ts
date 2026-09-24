// Contracts for the `dify-builder` Build, Edit, and Fix session API are generated
// from the backend OpenAPI document. This file only derives short feature-local
// aliases and owns client-only values.
import type {
  DifyBuilderActionResponse,
  DifyBuilderCanvasEventData,
  DifyBuilderChecklistErrorPayload,
  DifyBuilderCommandStartedEventData,
  DifyBuilderConversationPageResponse,
  DifyBuilderExecutionProgressResponse,
  DifyBuilderSessionViewResponse,
  FormField as GeneratedFormField,
  SessionModel as GeneratedSessionModel,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { TraceSnapshot } from './session/trace-buffer'

export type Action = DifyBuilderActionResponse
export type CanvasEventData = DifyBuilderCanvasEventData
export type ChecklistErrorPayload = DifyBuilderChecklistErrorPayload
type GeneratedConversationItem = DifyBuilderConversationPageResponse['data'][number]
type GeneratedAssistantTurn = Extract<GeneratedConversationItem, { kind: 'assistant_turn' }>
type ClientAssistantTurn = Omit<GeneratedAssistantTurn, 'payload'> & {
  payload: Omit<GeneratedAssistantTurn['payload'], 'stage_id'> & { stage_id?: string }
}
export type ConversationItem =
  | Exclude<GeneratedConversationItem, { kind: 'assistant_turn' }>
  | ClientAssistantTurn
export type DifyBuilderLocalUserMessage = {
  afterSequence: number
  localId: string
  sessionId: string | null
  text: string
  turnId?: string
}
export type DifyBuilderLocalInteractionResponse = {
  afterSequence: number
  baseVersion: number
  item: Extract<ConversationItem, { kind: 'interaction_response' }>
  localId: string
  sessionId: string
}
export type ConversationPage = DifyBuilderConversationPageResponse
export type FormField = GeneratedFormField
export type SessionModel = GeneratedSessionModel
export type SessionView = DifyBuilderSessionViewResponse
export type DifyBuilderDecision = NonNullable<SessionView['decision']>
export type DifyBuilderActiveInteraction = NonNullable<SessionView['active_interaction']> & {
  card: ConversationItem
}
export type DifyBuilderActiveCommand = Omit<DifyBuilderCommandStartedEventData, 'command_id'> & {
  command_id?: string
}

export type DifyBuilderStreamingTurn = {
  sessionId: string
  commandId: string
  operationId: string
  turnId: string
  sequence: number
  atVersion: number
  revision: number
  textBytes: number
  replyText: string
}

export type DifyBuilderExecutionProgress = {
  sessionId: string
  operationId: string
  atVersion: number
  revision: number
  execution: DifyBuilderExecutionProgressResponse
}

export type DifyBuilderReasoning = {
  sessionId: string
  operationId: string
  atVersion: number
  revision: number
  text: string
}

export type DifyBuilderSessionController = {
  startFix: (appId: string, failedRunId: string, modelConfig?: SessionModel) => Promise<boolean>
  startChecklistFix: (
    appId: string,
    checklistErrors: ChecklistErrorPayload[],
    modelConfig?: SessionModel,
  ) => Promise<boolean>
  startBuild: (
    appId: string,
    goalText: string,
    modelConfig?: SessionModel,
    deriveAppName?: boolean,
  ) => Promise<boolean>
  startEdit: (appId: string, goalText: string, modelConfig?: SessionModel) => Promise<boolean>
  loadOlderConversation: () => Promise<boolean>
  refresh: () => Promise<boolean>
  restore: (sessionId: string) => Promise<boolean>
  runAction: (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>
  sendMessage: (text: string, clientTurnId?: string) => Promise<boolean>
  updateModel: (modelConfig: SessionModel) => Promise<boolean>
  reset: () => void
  getTrace: () => TraceSnapshot
  onCanvasRefreshed: () => void
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

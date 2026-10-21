// Contracts for the `dify-builder` Build, Edit, and Fix session API are generated
// from the backend OpenAPI document. This file only derives short feature-local
// aliases and owns client-only values.
import type {
  DifyBuilderCanvasEventData,
  DifyBuilderChecklistErrorPayload,
  DifyBuilderCommandStartedEventData,
  DifyBuilderConversationPageResponse,
  DifyBuilderExecutionProgressResponse,
  DifyBuilderReceiptSnapshot,
  DifyBuilderSessionViewResponse,
  FormField as GeneratedFormField,
  SessionModel as GeneratedSessionModel,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { TraceSnapshot } from './session/trace-buffer'

export type CanvasEventData = DifyBuilderCanvasEventData
export type ChecklistErrorPayload = DifyBuilderChecklistErrorPayload
type GeneratedConversationItem = DifyBuilderConversationPageResponse['data'][number]
type GeneratedAssistantTurn = Extract<GeneratedConversationItem, { kind: 'assistant_turn' }>
type ClientAssistantTurn = Omit<GeneratedAssistantTurn, 'payload'> & {
  // Transient receive time; history hydration never adds it.
  receivedAt?: number
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
  replyLanguage?: string
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
  runAction: (
    actionId: string,
    payload?: Record<string, unknown>,
    receiptSnapshot?: DifyBuilderReceiptSnapshot,
  ) => Promise<boolean>
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

import type {
  BuilderErrorCode,
  DifyBuilderAttachmentPayload,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type {
  ConversationItem,
  DifyBuilderActiveCommand,
  DifyBuilderExecutionProgress,
  DifyBuilderLocalUserMessage,
  DifyBuilderReasoning,
  DifyBuilderStreamingTurn,
  SessionView,
} from '../types'
import { atom } from 'jotai'

export type DifyBuilderRetryableMessage = {
  sessionId: string
  text: string
  turnId: string
}

export type DifyBuilderTaskControl = {
  operation: 'stop' | 'resume'
  phase: 'saving' | 'pending' | 'unknown'
}

export const difyBuilderSessionViewAtom = atom<SessionView | null>(null)
export const difyBuilderReplyLanguageAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.reply_language ?? '',
)
export const difyBuilderActiveCommandAtom = atom<DifyBuilderActiveCommand | null>(null)
// The only session lifecycle value persisted by the browser. SessionView is
// an in-memory server projection rebuilt from GET on restore and updated by
// authoritative SSE frames while a command is live.
export const difyBuilderActiveSessionIdAtom = atom<string | null>(null)
export const difyBuilderConversationAtom = atom<ConversationItem[]>([])
export const difyBuilderLocalUserMessageAtom = atom<DifyBuilderLocalUserMessage | null>(null)
export const difyBuilderConversationHasMoreAtom = atom(false)
export const difyBuilderConversationLoadingAtom = atom(false)
export const difyBuilderSessionBusyAtom = atom(false)
export const difyBuilderTaskControlAtom = atom<DifyBuilderTaskControl | null>(null)
export type DifyBuilderLifecycleControl = {
  operation: 'clear' | 'abandon' | 'fix' | 'dismiss_fix' | 'stop_and_switch_fix'
  phase: 'pending' | 'unknown'
  sessionId: string
  clientActionId: string
  baseVersion: number
  expectedTaskId?: string
}
export const difyBuilderLifecycleControlAtom = atom<DifyBuilderLifecycleControl | null>(null)
export const difyBuilderMaterialControlAtom = atom<{
  phase: 'pending' | 'unknown' | 'accepted'
  clientTurnId: string
  attachments: DifyBuilderAttachmentPayload[]
  text: string
} | null>(null)
export const difyBuilderSessionLastErrorAtom = atom('')
export const difyBuilderSessionErrorCodeAtom = atom<BuilderErrorCode | null>(null)
export const difyBuilderRetryableMessageAtom = atom<DifyBuilderRetryableMessage | null>(null)
export const difyBuilderExecutionProgressAtom = atom<DifyBuilderExecutionProgress | null>(null)
export const difyBuilderReasoningAtom = atom<DifyBuilderReasoning | null>(null)
export const difyBuilderStreamingTurnAtom = atom<DifyBuilderStreamingTurn | null>(null)

export const difyBuilderSessionScopedAtoms = [
  difyBuilderSessionViewAtom,
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderTaskControlAtom,
  difyBuilderLifecycleControlAtom,
  difyBuilderMaterialControlAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionErrorCodeAtom,
  difyBuilderRetryableMessageAtom,
  difyBuilderExecutionProgressAtom,
  difyBuilderReasoningAtom,
  difyBuilderStreamingTurnAtom,
] as const

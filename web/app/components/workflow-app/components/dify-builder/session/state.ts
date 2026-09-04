import type {
  CanvasEventData,
  ConversationItem,
  DifyBuilderExecutionProgress,
  DifyBuilderReasoning,
  DifyBuilderStreamingTurn,
  SessionView,
} from '../types'
import { atom } from 'jotai'

export const difyBuilderSessionViewAtom = atom<SessionView | null>(null)
// The only session lifecycle value persisted by the browser. SessionView is
// an in-memory server projection rebuilt from GET on restore and updated by
// authoritative SSE frames while a command is live.
export const difyBuilderActiveSessionIdAtom = atom<string | null>(null)
export const difyBuilderConversationAtom = atom<ConversationItem[]>([])
export const difyBuilderConversationHasMoreAtom = atom(false)
export const difyBuilderConversationLoadingAtom = atom(false)
export const difyBuilderSessionBusyAtom = atom(false)
export const difyBuilderSessionLastErrorAtom = atom('')
export const difyBuilderExecutionProgressAtom = atom<DifyBuilderExecutionProgress | null>(null)
export const difyBuilderReasoningAtom = atom<DifyBuilderReasoning | null>(null)
export const difyBuilderStreamingTurnAtom = atom<DifyBuilderStreamingTurn | null>(null)
export const difyBuilderSessionLastCanvasEventAtom = atom<{
  id: number
  data: CanvasEventData
} | null>(null)

export const difyBuilderSessionScopedAtoms = [
  difyBuilderSessionViewAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderExecutionProgressAtom,
  difyBuilderReasoningAtom,
  difyBuilderStreamingTurnAtom,
  difyBuilderSessionLastCanvasEventAtom,
] as const

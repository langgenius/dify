import type {
  DifyBuilderAttachmentPayload,
  DifyBuilderStreamEventResponse,
  DifyBuilderTaskControlPayload,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { TFunction } from 'i18next'
import type { RefObject } from 'react'
import type { ConversationItem, SessionView } from '../types'
import type { DifyBuilderLifecycleControl } from './state'
import type { TraceBuffer } from './trace-buffer'
import type { SessionRunEvents, SessionStreamOutcome } from './types'
import type { useDifyBuilderExecutionProgress } from './use-execution-progress'
import type { useDifyBuilderReasoningBuffer } from './use-reasoning-buffer'
import type { useDifyBuilderStreamingTurnBuffer } from './use-streaming-turn-buffer'

export type PendingTaskControl = {
  sessionId: string
  operation: 'stop' | 'resume'
  body: DifyBuilderTaskControlPayload
  acknowledged: boolean
  rejected?: boolean
}

export type SessionControllerContext = {
  t: TFunction<['difyBuilder']>
  abortRef: RefObject<AbortController | null>
  lifecycleAbortRef: RefObject<AbortController | null>
  materialAbortRef: RefObject<AbortController | null>
  pendingTaskControlRef: RefObject<PendingTaskControl | null>
  nativeObservationRef: RefObject<number>
  pendingActionRef: RefObject<{ signature: string; id: string } | null>
  pendingMessageRef: RefObject<{ sessionId: string; text: string; turnId: string } | null>
  pendingRetestRef: RefObject<{
    sessionId: string
    version: number
    appRevision: string
    actionId: string
  } | null>
  traceRef: RefObject<TraceBuffer>
  executionProgress: ReturnType<typeof useDifyBuilderExecutionProgress>
  reasoningBuffer: ReturnType<typeof useDifyBuilderReasoningBuffer>
  streamingTurnBuffer: ReturnType<typeof useDifyBuilderStreamingTurnBuffer>
  prepareCommand: ((saveDraft: boolean, signal: AbortSignal) => Promise<void>) | undefined
  runEvents: SessionRunEvents | undefined
  onAttachmentsAccepted: SessionRunEvents['onAttachmentsAccepted']
  confirmLocalUserMessage: (sessionId: string, items: ConversationItem[]) => void
  syncConversation: (
    sessionId: string,
    targetLastSeq: number,
    controller: AbortController,
    replaceWithLatest?: boolean,
  ) => Promise<boolean>
  syncConversationRange: (
    sessionId: string,
    afterSequence: number,
    targetLastSeq: number,
    controller: AbortController,
  ) => Promise<boolean>
  applySessionView: (
    view: SessionView,
    observedAtStart?: number | 'native',
    reading?: AbortController,
  ) => boolean
  reconcileSession: (
    sessionId: string,
    controller: AbortController,
    replaceConversation?: boolean,
  ) => Promise<SessionStreamOutcome | undefined>
  consumeStream: (
    events: AsyncIterable<DifyBuilderStreamEventResponse>,
    controller: AbortController,
    initialSessionId?: string,
    observedAtStart?: number,
    initialAttachments?: DifyBuilderAttachmentPayload[],
  ) => Promise<SessionStreamOutcome>
  isolateClearedConversation: (reading?: AbortController) => void
  lifecycleError: (
    operation: DifyBuilderLifecycleControl['operation'],
    error: unknown,
    controller: AbortController,
  ) => Promise<void>
}

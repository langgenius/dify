import type {
  DifyBuilderAgentMessageEventData,
  DifyBuilderCommandFinishedEventData,
  DifyBuilderConversationItemAppendedEventData,
  DifyBuilderConversationPageResponse,
  DifyBuilderProgressEventData,
  DifyBuilderReasoningEventData,
  DifyBuilderStreamEventResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ReactNode } from 'react'
import type { ConversationItem, SessionView } from '../../types'
import { renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useDifyBuilderSessionController } from '../use-session-controller'

export const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  session_id: 'session-1',
  version: 1,
  phase: 'understand',
  canvas_read_only: true,
  run_status: 'processing',
  interrupted: false,
  last_command_id: 'command-1',
  conversation_last_seq: -1,
  active_interaction: null,
  app_revision: { current: 'revision-1', conflicted: false },
  ...overrides,
})

export const commandStartedEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'command_started',
  data: {
    session_id: view.session_id,
    command_id: 'command-1',
    version: view.version,
    phase: view.phase ?? 'understand',
    run_status: 'processing',
  },
})

export const conversationPage = (
  data: ConversationItem[] = [],
  hasMore = false,
): DifyBuilderConversationPageResponse => ({
  data: data as DifyBuilderConversationPageResponse['data'],
  has_more: hasMore,
  first_seq: data[0]?.seq ?? null,
  last_seq: data.at(-1)?.seq ?? null,
})

export const stateEvent = (
  view: SessionView,
  overrides: Partial<DifyBuilderCommandFinishedEventData> = {},
): DifyBuilderStreamEventResponse => {
  const { last_command_id: lastCommandId, ...state } = view
  return {
    event: 'command_finished',
    data: {
      ...state,
      command_id: lastCommandId || 'command-1',
      ...overrides,
    },
  }
}

export const agentMessageEvent = (
  delta: string,
  revision = 1,
  overrides: Partial<DifyBuilderAgentMessageEventData> = {},
): DifyBuilderStreamEventResponse => ({
  event: 'agent_message',
  data: {
    session_id: 'session-1',
    command_id: 'command-1',
    operation_id: 'operation-1',
    turn_id: 'turn-1',
    delta,
    seq: 1,
    at_version: 4,
    revision,
    done: false,
    text_bytes: new TextEncoder().encode(delta).byteLength,
    ...overrides,
  },
})

export const conversationItemEvent = (
  item: DifyBuilderConversationItemAppendedEventData['item'],
): DifyBuilderStreamEventResponse => ({
  event: 'conversation_item_appended',
  data: {
    session_id: 'session-1',
    command_id: 'command-1',
    item,
  },
})

export const progressEvent = (
  overrides: Partial<DifyBuilderProgressEventData> = {},
): DifyBuilderStreamEventResponse => ({
  event: 'progress',
  data: {
    session_id: 'session-1',
    operation_id: 'operation-1',
    at_version: 2,
    revision: 1,
    status: 'running',
    activity: {
      id: 'fix-run-validation',
      label: 'Run the repaired workflow',
      state: 'active',
    },
    ...overrides,
  },
})

export const reasoningEvent = (
  delta: string,
  overrides: Partial<DifyBuilderReasoningEventData> = {},
): DifyBuilderStreamEventResponse => ({
  event: 'reasoning',
  data: {
    session_id: 'session-1',
    operation_id: 'operation-1',
    at_version: 2,
    revision: 1,
    delta,
    ...overrides,
  },
})

export async function* streamOf(
  ...events: DifyBuilderStreamEventResponse[]
): AsyncGenerator<DifyBuilderStreamEventResponse> {
  yield* events
}

type ControlledItem =
  | { event: DifyBuilderStreamEventResponse }
  | { done: true }
  | { error: unknown }

export const createControlledEventStream = () => {
  const queue: ControlledItem[] = []
  let waiter: ((item: ControlledItem) => void) | undefined

  const send = (item: ControlledItem) => {
    if (waiter) {
      const resolve = waiter
      waiter = undefined
      resolve(item)
    } else {
      queue.push(item)
    }
  }

  const next = () => {
    const item = queue.shift()
    return item
      ? Promise.resolve(item)
      : new Promise<ControlledItem>((resolve) => (waiter = resolve))
  }

  const iterable = (async function* () {
    while (true) {
      const item = await next()
      if ('error' in item) throw item.error
      if ('done' in item) return
      yield item.event
    }
  })()

  return {
    iterable,
    push: (event: DifyBuilderStreamEventResponse) => send({ event }),
    close: () => send({ done: true }),
    error: (error: unknown) => send({ error }),
  }
}

export const renderSessionHook = (
  prepareCommand?: Parameters<typeof useDifyBuilderSessionController>[0],
  runEvents?: Parameters<typeof useDifyBuilderSessionController>[1],
) => {
  const store = createStore()
  const rendered = renderHook(() => useDifyBuilderSessionController(prepareCommand, runEvents), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  })
  return { ...rendered, store }
}

export const installAnimationFrameMock = () => {
  const animationFrames = new Map<number, FrameRequestCallback>()
  let nextAnimationFrameId = 0
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      nextAnimationFrameId += 1
      animationFrames.set(nextAnimationFrameId, callback)
      return nextAnimationFrameId
    }),
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => animationFrames.delete(id)),
  )

  return () => {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    callbacks.forEach((callback) => callback(performance.now()))
  }
}

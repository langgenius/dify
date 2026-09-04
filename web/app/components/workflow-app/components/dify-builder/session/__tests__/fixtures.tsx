import type {
  DifyBuilderConversationPageResponse,
  DifyBuilderStreamEventResponse,
  ProgressEventData,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ReactNode } from 'react'
import type { ConversationItem, SessionView } from '../../types'
import { renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useDifyBuilderSessionController } from '../use-session-controller'

export const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  session_id: 'session-1',
  app_id: 'app-1',
  version: 1,
  state: 'fix.diagnose',
  canvas_read_only: true,
  run_status: 'executing',
  interrupted: false,
  conversation_last_seq: -1,
  active_interaction: null,
  app_revision: { observed: 'revision-1', current: 'revision-1', conflicted: false },
  ...overrides,
})

export const commandStartedEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'command_started',
  data: { kind: 'command_started', ...view },
})

export const conversationPage = (
  data: ConversationItem[] = [],
  hasMore = false,
): DifyBuilderConversationPageResponse => ({
  data,
  has_more: hasMore,
  first_seq: data[0]?.seq ?? null,
  last_seq: data.at(-1)?.seq ?? null,
})

export const stateEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'state',
  data: { kind: 'state', ...view },
})

export const agentMessageEvent = (
  answer: string,
  revision = 1,
): DifyBuilderStreamEventResponse => ({
  event: 'agent_message',
  data: {
    kind: 'agent_message',
    session_id: 'session-1',
    operation_id: 'operation-1',
    id: 'turn-1',
    answer,
    seq: 1,
    at_version: 4,
    revision,
    stage_id: 'fix.await_approval',
  },
})

export const progressEvent = (
  overrides: Partial<ProgressEventData> = {},
): DifyBuilderStreamEventResponse => ({
  event: 'progress',
  data: {
    kind: 'progress',
    session_id: 'session-1',
    operation_id: 'operation-1',
    stage_id: 'fix.verify',
    at_version: 2,
    revision: 1,
    trace: {
      status: 'running',
      steps: [
        {
          id: 'fix-run-validation',
          label: 'Run the repaired workflow',
          state: 'active',
          tone: 'neutral',
        },
      ],
    },
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

export const renderSessionHook = () => {
  const store = createStore()
  const rendered = renderHook(() => useDifyBuilderSessionController(), {
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

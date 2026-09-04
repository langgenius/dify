import { act, waitFor } from '@testing-library/react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderLiveProgressAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderStreamingTurnAtom,
} from '../state'
import {
  agentMessageEvent,
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  installAnimationFrameMock,
  progressEvent,
  renderSessionHook,
  stateEvent,
  streamOf,
} from './fixtures'

const clientMocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  conversation: vi.fn(),
  stream: vi.fn(),
  action: vi.fn(),
  message: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: clientMocks.create,
        bySessionId: {
          get: clientMocks.get,
          conversation: { get: clientMocks.conversation },
          stream: { get: clientMocks.stream },
          actions: { post: clientMocks.action },
          messages: { post: clientMocks.message },
        },
      },
    },
  },
}))

describe('useDifyBuilderSessionController streaming', () => {
  let flushAnimationFrames: () => void

  beforeEach(() => {
    vi.resetAllMocks()
    clientMocks.conversation.mockResolvedValue(conversationPage())
    flushAnimationFrames = installAnimationFrameMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('coalesces assistant deltas per frame and lets authoritative events replace them', async () => {
    const initialItem = {
      seq: 0,
      at_version: 1,
      kind: 'user' as const,
      payload: { text: 'Try a smaller repair', turn_id: 'turn-user-1' },
    }
    const waiting = createSessionView({
      conversation_last_seq: 0,
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    const turn = {
      seq: 1,
      at_version: 4,
      kind: 'assistant_turn' as const,
      payload: {
        turn_id: 'turn-1',
        stage_id: 'fix.await_approval',
        trace: { status: 'completed' },
        reply_text: 'A smaller repair',
      },
    }
    const terminal = createSessionView({
      ...waiting,
      version: 4,
      conversation_last_seq: 1,
    })
    const stream = createControlledEventStream()
    clientMocks.conversation.mockResolvedValue(conversationPage([initialItem]))
    clientMocks.message.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    let messagePromise!: Promise<boolean>
    act(() => {
      messagePromise = result.current.sendMessage('  Try a smaller repair  ')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))
    act(() => {
      stream.push(commandStartedEvent({ ...waiting }))
    })
    await waitFor(() => expect(store.get(difyBuilderSessionViewAtom)).not.toBe(waiting))
    const committedViewListener = vi.fn()
    const unsubscribe = store.sub(difyBuilderSessionViewAtom, committedViewListener)

    act(() => {
      stream.push(agentMessageEvent('A ', 1))
      stream.push(agentMessageEvent('smaller ', 2))
      stream.push(agentMessageEvent('repair', 3))
      stream.push(agentMessageEvent('smaller ', 2))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())

    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem])
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    act(flushAnimationFrames)
    expect(store.get(difyBuilderStreamingTurnAtom)?.replyText).toBe('A smaller repair')
    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem])
    expect(committedViewListener).not.toHaveBeenCalled()

    act(() => {
      stream.push({
        event: 'commit',
        data: {
          kind: 'commit',
          session_id: 'session-1',
          operation_id: 'operation-1',
          stage_id: 'fix.await_approval',
          at_version: 4,
          version: 4,
          state: 'fix.await_approval',
          settled: true,
          items: [turn],
        },
      })
    })
    await waitFor(() => expect(store.get(difyBuilderSessionViewAtom)?.version).toBe(4))
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem, turn])
    expect(committedViewListener).toHaveBeenCalledOnce()
    unsubscribe()

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await messagePromise).toBe(true)
    })

    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
    expect(clientMocks.message).toHaveBeenCalledWith(
      {
        params: { session_id: 'session-1' },
        body: {
          text: 'Try a smaller repair',
          base_version: 2,
          client_turn_id: expect.any(String),
        },
      },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('repairs a dropped commit through conversation JSON before merging a later commit', async () => {
    const initialItem = {
      seq: 0,
      at_version: 1,
      kind: 'notice' as const,
      payload: { text: 'Initial state' },
    }
    const missedItem = {
      seq: 1,
      at_version: 2,
      kind: 'notice' as const,
      payload: { text: 'Missed commit' },
    }
    const receivedItem = {
      seq: 2,
      at_version: 3,
      kind: 'notice' as const,
      payload: { text: 'Later commit' },
    }
    const futureItem = {
      seq: 3,
      at_version: 4,
      kind: 'notice' as const,
      payload: { text: 'Concurrent future commit' },
    }
    const waiting = createSessionView({
      conversation_last_seq: 0,
      run_status: 'waiting_input',
      state: 'fix.await_approval',
    })
    const terminal = createSessionView({
      ...waiting,
      conversation_last_seq: 2,
      version: 3,
    })
    const stream = createControlledEventStream()
    clientMocks.message.mockResolvedValue(stream.iterable)
    clientMocks.conversation.mockResolvedValue(
      conversationPage([missedItem, receivedItem, futureItem]),
    )
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      store.set(difyBuilderConversationAtom, [initialItem])
    })

    let messagePromise!: Promise<boolean>
    act(() => {
      messagePromise = result.current.sendMessage('Continue')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))
    act(() => {
      stream.push(commandStartedEvent(waiting))
      stream.push({
        event: 'commit',
        data: {
          kind: 'commit',
          session_id: 'session-1',
          operation_id: 'operation-1',
          stage_id: 'fix.await_approval',
          at_version: 3,
          version: 3,
          state: 'fix.await_approval',
          settled: true,
          items: [receivedItem],
        },
      })
    })

    await waitFor(() =>
      expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0, 1, 2]),
    )
    expect(clientMocks.conversation).toHaveBeenCalledWith(
      {
        params: { session_id: 'session-1' },
        query: { after_seq: 0, limit: 100 },
      },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await messagePromise).toBe(true)
    })
  })

  it('clears stale streaming state when switching sessions', async () => {
    const restored = createSessionView({
      session_id: 'session-restored',
      run_status: 'waiting_input',
      state: 'fix.await_approval',
    })
    clientMocks.get.mockResolvedValue(restored)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderLiveProgressAtom, {
        sessionId: 'session-old',
        operationId: 'operation-old',
        stageId: 'fix.diagnose',
        atVersion: 2,
        revision: 1,
        trace: { status: 'running', steps: [] },
      })
      store.set(difyBuilderStreamingTurnAtom, {
        sessionId: 'session-old',
        operationId: 'operation-old',
        turnId: 'turn-old',
        sequence: 1,
        atVersion: 2,
        revision: 1,
        stageId: 'fix.diagnose',
        replyText: 'stale',
      })
    })

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(store.get(difyBuilderLiveProgressAtom)).toBeNull()
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(restored)
  })

  it('aborts an in-flight stream and cancels its pending frame when reset', async () => {
    const started = createSessionView()
    const stream = createControlledEventStream()
    clientMocks.create.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startBuild('app-1', 'Build a support workflow')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))
    act(() => {
      stream.push(commandStartedEvent(started))
      stream.push(progressEvent())
      stream.push(agentMessageEvent('Partial response'))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())

    act(() => result.current.reset())
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderLiveProgressAtom)).toBeNull()
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderSessionViewAtom)).toBeNull()

    await act(async () => {
      stream.close()
      expect(await startPromise).toBe(false)
    })
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
    expect(store.get(difyBuilderSessionLastCanvasEventAtom)).toBeNull()
  })

  it('projects progress and node status until the matching commit becomes authoritative', async () => {
    const started = createSessionView()
    const terminal = createSessionView({
      version: 2,
      state: 'fix.await_decision',
      run_status: 'waiting_input',
    })
    const stream = createControlledEventStream()
    clientMocks.create.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startFix('app-1', 'run-1')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))

    act(() => {
      stream.push(commandStartedEvent(started))
      stream.push(progressEvent())
    })
    await waitFor(() =>
      expect(store.get(difyBuilderLiveProgressAtom)?.trace.steps?.[0]?.state).toBe('active'),
    )

    act(() => {
      stream.push({
        event: 'node',
        data: {
          kind: 'node',
          session_id: 'session-1',
          operation_id: 'other-operation',
          stage_id: 'fix.verify',
          at_version: 2,
          revision: 1,
          node_id: 'stale-node',
          title: 'Stale node',
          status: 'running',
          error: '',
        },
      })
      stream.push(
        progressEvent({
          revision: 2,
          trace: {
            status: 'running',
            steps: [
              {
                id: 'fix-evaluate-validation',
                label: 'Evaluate validation results',
                state: 'active',
              },
            ],
          },
        }),
      )
    })
    await waitFor(() => expect(store.get(difyBuilderLiveProgressAtom)?.revision).toBe(2))
    expect(store.get(difyBuilderLiveProgressAtom)?.trace.steps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'node:stale-node' })]),
    )

    act(() => {
      stream.push({
        event: 'node',
        data: {
          kind: 'node',
          session_id: 'session-1',
          operation_id: 'operation-1',
          stage_id: 'fix.verify',
          at_version: 2,
          revision: 2,
          node_id: 'llm-node',
          title: 'Generate answer',
          status: 'running',
          error: '',
        },
      })
    })
    await waitFor(() =>
      expect(store.get(difyBuilderLiveProgressAtom)?.trace.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'node:llm-node',
            label: 'Generate answer',
            state: 'active',
          }),
        ]),
      ),
    )

    act(() => {
      stream.push({
        event: 'node',
        data: {
          kind: 'node',
          session_id: 'session-1',
          operation_id: 'operation-1',
          stage_id: 'fix.verify',
          at_version: 2,
          revision: 4,
          node_id: 'llm-node',
          title: 'Generate answer',
          status: 'success',
          error: '',
        },
      })
      stream.push({
        event: 'node',
        data: {
          kind: 'node',
          session_id: 'session-1',
          operation_id: 'operation-1',
          stage_id: 'fix.verify',
          at_version: 2,
          revision: 3,
          node_id: 'llm-node',
          title: 'Generate answer',
          status: 'running',
          error: '',
        },
      })
    })
    await waitFor(() =>
      expect(
        store
          .get(difyBuilderLiveProgressAtom)
          ?.trace.steps?.find((step) => step.id === 'node:llm-node')?.state,
      ).toBe('done'),
    )

    expect(store.get(difyBuilderLiveProgressAtom)?.trace.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fix-evaluate-validation' }),
        expect.objectContaining({ id: 'node:llm-node' }),
      ]),
    )

    act(() => {
      stream.push(progressEvent())
    })
    expect(store.get(difyBuilderLiveProgressAtom)?.revision).toBe(2)

    act(() => {
      stream.push({
        event: 'commit',
        data: {
          kind: 'commit',
          session_id: 'session-1',
          operation_id: 'operation-1',
          stage_id: 'fix.verify',
          at_version: 2,
          version: 2,
          state: 'fix.await_decision',
          settled: true,
          items: [],
        },
      })
    })
    await waitFor(() => expect(store.get(difyBuilderLiveProgressAtom)).toBeNull())

    act(() => {
      stream.push(progressEvent())
    })
    await waitFor(() => expect(store.get(difyBuilderLiveProgressAtom)).toBeNull())

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await startPromise).toBe(true)
    })
  })

  it('clears live progress when the server terminates the command with an error', async () => {
    const stream = createControlledEventStream()
    clientMocks.create.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startFix('app-1', 'run-1')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))

    act(() => {
      stream.push(commandStartedEvent(createSessionView()))
      stream.push(progressEvent())
    })
    await waitFor(() => expect(store.get(difyBuilderLiveProgressAtom)).not.toBeNull())

    await act(async () => {
      stream.push({ event: 'error', data: { kind: 'error', error: 'step failed' } })
      expect(await startPromise).toBe(false)
    })

    expect(store.get(difyBuilderLiveProgressAtom)).toBeNull()
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('step failed')
  })

  it('recovers a transport failure when GET confirms the committed version', async () => {
    const initial = createSessionView()
    const reconciled = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_confirmation',
    })
    const stream = createControlledEventStream()
    clientMocks.create.mockResolvedValue(stream.iterable)
    clientMocks.get.mockResolvedValue(reconciled)
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startFix('app-1', 'run-1')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))

    act(() => {
      stream.push(commandStartedEvent(initial))
      stream.push({
        event: 'commit',
        data: {
          kind: 'commit',
          session_id: 'session-1',
          operation_id: 'operation-1',
          stage_id: 'fix.diagnose',
          at_version: 2,
          version: 2,
          state: 'fix.await_approval',
          settled: true,
          items: [],
        },
      })
      stream.error(new Error('connection lost'))
    })

    await act(async () => {
      expect(await startPromise).toBe(true)
    })
    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(reconciled)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })

  it('keeps a durable failed state but reports the command as unsuccessful', async () => {
    const errorItem = {
      seq: 1,
      at_version: 2,
      kind: 'error' as const,
      payload: {
        title: 'Builder step failed',
        body: 'Restart from the current draft to continue.',
      },
    }
    const failed = createSessionView({
      version: 2,
      state: 'failed',
      run_status: 'failed',
      actions: [{ id: 'restart', label: 'Restart from current draft', kind: 'primary' }],
      conversation_last_seq: 1,
    })
    clientMocks.conversation
      .mockResolvedValueOnce(conversationPage())
      .mockResolvedValueOnce(conversationPage([errorItem]))
    clientMocks.create.mockResolvedValue(
      streamOf(commandStartedEvent(createSessionView()), stateEvent(failed)),
    )
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.startFix('app-1', 'run-1')).toBe(false)
    })

    expect(store.get(difyBuilderSessionViewAtom)).toEqual(failed)
    expect(store.get(difyBuilderConversationAtom)).toEqual([errorItem])
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })
})

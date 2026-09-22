import type { ConversationItem } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { nodeStarted, workflowEvent } from '../../__tests__/workflow-fixtures'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderExecutionProgressAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderReasoningAtom,
  difyBuilderRetryableMessageAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderStreamingTurnAtom,
} from '../state'
import {
  agentMessageEvent,
  commandStartedEvent,
  conversationItemEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  installAnimationFrameMock,
  progressEvent,
  reasoningEvent,
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

vi.mock('@/service/console', () => ({
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

  it('shows a user message immediately and replaces it with the durable SSE item', async () => {
    const waiting = createSessionView({
      conversation_last_seq: -1,
      version: 2,
      run_status: 'waiting_input',
    })
    const terminal = createSessionView({
      ...waiting,
      conversation_last_seq: 0,
      version: 3,
    })
    const stream = createControlledEventStream()
    clientMocks.message.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    let messagePromise!: Promise<boolean>
    act(() => {
      messagePromise = result.current.sendMessage('  Show this immediately  ')
    })

    const localMessage = store.get(difyBuilderLocalUserMessageAtom)
    expect(localMessage).toMatchObject({
      afterSequence: -1,
      localId: expect.any(String),
      sessionId: waiting.session_id,
      text: 'Show this immediately',
      turnId: expect.any(String),
    })
    expect(store.get(difyBuilderConversationAtom)).toEqual([])

    const committedMessage: ConversationItem = {
      seq: 0,
      at_version: 3,
      kind: 'user',
      payload: {
        text: localMessage!.text,
        turn_id: localMessage!.turnId!,
      },
    }
    act(() => {
      stream.push(commandStartedEvent(waiting))
      stream.push(conversationItemEvent(committedMessage))
    })

    await waitFor(() => expect(store.get(difyBuilderLocalUserMessageAtom)).toBeNull())
    expect(store.get(difyBuilderConversationAtom)).toEqual([committedMessage])

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await messagePromise).toBe(true)
    })
    expect(store.get(difyBuilderConversationAtom)).toEqual([committedMessage])
    expect(clientMocks.conversation).not.toHaveBeenCalled()
  })

  it('binds a local new-session prompt to the session before the durable item arrives', async () => {
    const started = createSessionView({ conversation_last_seq: -1 })
    const terminal = createSessionView({
      ...started,
      conversation_last_seq: 0,
      run_status: 'waiting_input',
      version: 2,
    })
    const localMessage = {
      afterSequence: -1,
      localId: 'local-start-1',
      sessionId: null,
      text: 'Build an expense assistant',
    }
    const committedMessage: ConversationItem = {
      seq: 0,
      at_version: 0,
      kind: 'user',
      payload: { text: localMessage.text, turn_id: 'server-turn-1' },
    }
    const stream = createControlledEventStream()
    clientMocks.create.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderLocalUserMessageAtom, localMessage)
    })

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startBuild('app-1', localMessage.text)
    })
    await waitFor(() => expect(clientMocks.create).toHaveBeenCalledOnce())
    expect(store.get(difyBuilderLocalUserMessageAtom)).toEqual(localMessage)

    act(() => {
      stream.push(commandStartedEvent(started))
    })
    await waitFor(() =>
      expect(store.get(difyBuilderLocalUserMessageAtom)?.sessionId).toBe(started.session_id),
    )

    act(() => {
      stream.push(conversationItemEvent(committedMessage))
    })
    await waitFor(() => expect(store.get(difyBuilderLocalUserMessageAtom)).toBeNull())
    expect(store.get(difyBuilderConversationAtom)).toEqual([committedMessage])

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await startPromise).toBe(true)
    })
  })

  it('coalesces assistant deltas and promotes the streamed text without a history request', async () => {
    const reply = 'A smaller repair with carefully limited workflow changes.'
    const replyChunks = [
      'A smaller repair ',
      'with carefully ',
      'limited workflow changes.',
    ] as const
    const replyBytes = new TextEncoder().encode(reply).byteLength
    const initialItem = {
      seq: 0,
      at_version: 1,
      kind: 'user' as const,
      payload: { text: 'Try a smaller repair', turn_id: 'turn-user-1' },
    }
    const waiting = createSessionView({
      conversation_last_seq: 0,
      version: 2,
      run_status: 'waiting_input',
    })
    const turn: ConversationItem = {
      seq: 1,
      at_version: 4,
      kind: 'assistant_turn' as const,
      payload: {
        turn_id: 'turn-1',
        execution: { status: 'completed' },
        reasoning_text: undefined,
        reply_text: reply,
        cards: [],
      },
    }
    const followingItem = {
      seq: 2,
      at_version: 4,
      kind: 'notice' as const,
      payload: { text: 'The next durable item' },
    }
    const terminal = createSessionView({
      ...waiting,
      version: 4,
      conversation_last_seq: 2,
    })
    const stream = createControlledEventStream()
    clientMocks.message.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      store.set(difyBuilderConversationAtom, [initialItem])
    })

    let messagePromise!: Promise<boolean>
    act(() => {
      messagePromise = result.current.sendMessage('  Try a smaller repair  ')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))
    act(() => {
      stream.push(commandStartedEvent({ ...waiting }))
    })
    await waitFor(() =>
      expect(store.get(difyBuilderActiveCommandAtom)?.command_id).toBe('command-1'),
    )
    expect(store.get(difyBuilderSessionViewAtom)).toBe(waiting)
    const committedViewListener = vi.fn()
    const unsubscribe = store.sub(difyBuilderSessionViewAtom, committedViewListener)

    act(() => {
      stream.push(agentMessageEvent(replyChunks[0], 1, { text_bytes: 17 }))
      stream.push(agentMessageEvent(replyChunks[1], 2, { text_bytes: 32 }))
      stream.push(agentMessageEvent(replyChunks[2], 3, { text_bytes: replyBytes }))
      stream.push(agentMessageEvent(replyChunks[1], 2, { text_bytes: 32 }))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())

    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem])
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    act(flushAnimationFrames)
    expect(store.get(difyBuilderStreamingTurnAtom)?.replyText).toBe(
      Array.from(reply).slice(0, 24).join(''),
    )
    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem])
    expect(committedViewListener).not.toHaveBeenCalled()

    act(() => {
      stream.push(
        agentMessageEvent('', 4, {
          done: true,
          execution: { status: 'completed' },
          text_bytes: replyBytes,
        }),
      )
      stream.push(conversationItemEvent(followingItem))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2))
    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem])

    act(() => {
      flushAnimationFrames()
      flushAnimationFrames()
    })
    expect(store.get(difyBuilderStreamingTurnAtom)?.replyText).toBe(reply)
    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem])
    act(flushAnimationFrames)
    await waitFor(() =>
      expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem, turn, followingItem]),
    )

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await messagePromise).toBe(true)
    })

    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem, turn, followingItem])
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
    expect(committedViewListener).toHaveBeenCalledOnce()
    expect(clientMocks.conversation).not.toHaveBeenCalled()
    unsubscribe()
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

  it('recovers the persisted reply when the final byte count exposes a missing delta', async () => {
    const initialItem = {
      seq: 0,
      at_version: 1,
      kind: 'notice' as const,
      payload: { text: 'Initial state' },
    }
    const persistedReply: ConversationItem = {
      seq: 1,
      at_version: 4,
      kind: 'assistant_turn',
      payload: {
        turn_id: 'turn-1',
        stage_id: 'fix.await_approval',
        execution: { status: 'completed' },
        reply_text: 'Partial reply',
        cards: [],
      },
    }
    const waiting = createSessionView({
      conversation_last_seq: 0,
      version: 2,
      run_status: 'waiting_input',
    })
    const terminal = createSessionView({
      ...waiting,
      conversation_last_seq: 1,
      version: 4,
    })
    const stream = createControlledEventStream()
    clientMocks.message.mockResolvedValue(stream.iterable)
    clientMocks.conversation.mockResolvedValue(conversationPage([persistedReply]))
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
      stream.push(agentMessageEvent('Partial', 1, { text_bytes: 7 }))
      stream.push(
        agentMessageEvent('', 2, {
          done: true,
          execution: { status: 'completed' },
          text_bytes: 13,
        }),
      )
    })

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await messagePromise).toBe(true)
    })

    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderConversationAtom)).toEqual([initialItem, persistedReply])
    expect(clientMocks.conversation).toHaveBeenCalledWith(
      {
        params: { session_id: 'session-1' },
        query: { after_seq: 0, limit: 100 },
      },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
  })

  it('marks a failed user turn as retryable and reuses its client turn id', async () => {
    const waiting = createSessionView({
      conversation_last_seq: -1,
      version: 2,
      run_status: 'waiting_input',
    })
    const reconciled = createSessionView({
      ...waiting,
      conversation_last_seq: 0,
      version: 3,
    })
    const stream = createControlledEventStream()
    clientMocks.message.mockResolvedValueOnce(stream.iterable)
    clientMocks.get.mockResolvedValue(reconciled)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    let messagePromise!: Promise<boolean>
    act(() => {
      messagePromise = result.current.sendMessage('Retry me')
    })
    await waitFor(() => expect(clientMocks.message).toHaveBeenCalledOnce())
    const firstRequest = clientMocks.message.mock.calls[0]?.[0] as {
      body: { client_turn_id: string }
    }
    const clientTurnId = firstRequest.body.client_turn_id
    const userItem: ConversationItem = {
      seq: 0,
      at_version: 3,
      kind: 'user',
      payload: { text: 'Retry me', turn_id: clientTurnId },
    }
    clientMocks.conversation.mockResolvedValue(conversationPage([userItem]))

    act(() => {
      stream.push(commandStartedEvent(waiting))
    })

    await act(async () => {
      stream.push({
        event: 'error',
        data: {
          message: 'message failed',
          session_id: 'session-1',
          command_id: 'command-1',
        },
      })
      expect(await messagePromise).toBe(false)
    })
    expect(store.get(difyBuilderConversationAtom)).toEqual([userItem])
    expect(store.get(difyBuilderRetryableMessageAtom)).toEqual({
      sessionId: 'session-1',
      text: 'Retry me',
      turnId: clientTurnId,
    })

    const retryTerminal = createSessionView({
      ...reconciled,
      version: 4,
    })
    clientMocks.message.mockResolvedValueOnce(
      streamOf(commandStartedEvent(reconciled), stateEvent(retryTerminal)),
    )

    await act(async () => {
      expect(await result.current.sendMessage('Retry me', clientTurnId)).toBe(true)
    })
    expect(clientMocks.message).toHaveBeenNthCalledWith(
      2,
      {
        params: { session_id: 'session-1' },
        body: {
          text: 'Retry me',
          base_version: 3,
          client_turn_id: clientTurnId,
        },
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderRetryableMessageAtom)).toBeNull()
  })

  it('repairs conversation gaps from JSON when the command finishes', async () => {
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
    })
    expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0])

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await messagePromise).toBe(true)
    })
    expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0, 1, 2])
    expect(clientMocks.conversation).toHaveBeenCalledWith(
      {
        params: { session_id: 'session-1' },
        query: { after_seq: 0, limit: 100 },
      },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
  })

  it('clears stale streaming state when switching sessions', async () => {
    const restored = createSessionView({
      session_id: 'session-restored',
      run_status: 'waiting_input',
    })
    clientMocks.get.mockResolvedValue(restored)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderExecutionProgressAtom, {
        sessionId: 'session-old',
        operationId: 'operation-old',
        atVersion: 2,
        revision: 1,
        execution: { status: 'running', activities: [] },
      })
      store.set(difyBuilderReasoningAtom, {
        sessionId: 'session-old',
        operationId: 'operation-old',
        atVersion: 2,
        revision: 1,
        text: 'stale reasoning',
      })
      store.set(difyBuilderStreamingTurnAtom, {
        sessionId: 'session-old',
        commandId: 'command-old',
        operationId: 'operation-old',
        turnId: 'turn-old',
        sequence: 1,
        atVersion: 2,
        revision: 1,
        textBytes: 5,
        replyText: 'stale',
      })
    })

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(store.get(difyBuilderExecutionProgressAtom)).toBeNull()
    expect(store.get(difyBuilderReasoningAtom)).toBeNull()
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
      stream.push(reasoningEvent('Partial reasoning'))
      stream.push(agentMessageEvent('Partial response'))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2))

    act(() => result.current.reset())
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledTimes(2)
    expect(store.get(difyBuilderExecutionProgressAtom)).toBeNull()
    expect(store.get(difyBuilderReasoningAtom)).toBeNull()
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderSessionViewAtom)).toBeNull()

    await act(async () => {
      stream.close()
      expect(await startPromise).toBe(false)
    })
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })

  it('reduces ordered progress deltas without merging raw node events', async () => {
    const started = createSessionView()
    const terminal = createSessionView({
      version: 2,
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
      expect(store.get(difyBuilderExecutionProgressAtom)?.execution.activities?.[0]?.state).toBe(
        'active',
      ),
    )

    act(() => {
      stream.push({
        event: 'workflow',
        data: workflowEvent(
          {
            ...nodeStarted(),
            data: { ...nodeStarted().data, node_id: 'stale-node', title: 'Stale node' },
          },
          {
            operation_id: 'other-operation',
            revision: 1,
          },
        ),
      })
      stream.push(
        progressEvent({
          revision: 2,
          status: 'running',
          activity: {
            id: 'fix-run-validation',
            label: 'Run the repaired workflow',
            state: 'done',
          },
        }),
      )
    })
    await waitFor(() => expect(store.get(difyBuilderExecutionProgressAtom)?.revision).toBe(2))
    expect(store.get(difyBuilderExecutionProgressAtom)?.execution.activities).toEqual([
      expect.objectContaining({ id: 'fix-run-validation', state: 'done' }),
    ])
    expect(store.get(difyBuilderExecutionProgressAtom)?.execution.activities).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'node:stale-node' })]),
    )

    act(() => {
      stream.push({
        event: 'workflow',
        data: workflowEvent(
          {
            ...nodeStarted(),
            data: { ...nodeStarted().data, node_id: 'llm-node', title: 'Generate answer' },
          },
          {
            revision: 2,
          },
        ),
      })
    })
    await waitFor(() => expect(store.get(difyBuilderExecutionProgressAtom)?.revision).toBe(2))
    expect(store.get(difyBuilderExecutionProgressAtom)?.execution.activities).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'node:llm-node' })]),
    )

    act(() => {
      stream.push(
        progressEvent({
          revision: 3,
          status: 'running',
          activity: {
            id: 'fix-evaluate-validation',
            label: 'Evaluate validation results',
            state: 'active',
          },
        }),
      )
    })
    await waitFor(() =>
      expect(
        store
          .get(difyBuilderExecutionProgressAtom)
          ?.execution.activities?.find((activity) => activity.id === 'fix-evaluate-validation')
          ?.state,
      ).toBe('active'),
    )

    act(() => {
      stream.push(
        progressEvent({
          revision: 4,
          status: 'running',
          activity: {
            id: 'node:llm-node',
            label: 'Generate answer',
            state: 'active',
            parent_id: 'fix-evaluate-validation',
          },
        }),
      )
    })
    await waitFor(() => expect(store.get(difyBuilderExecutionProgressAtom)?.revision).toBe(4))

    expect(store.get(difyBuilderExecutionProgressAtom)?.execution.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fix-run-validation', state: 'done' }),
        expect.objectContaining({ id: 'fix-evaluate-validation' }),
        expect.objectContaining({ id: 'node:llm-node' }),
      ]),
    )

    act(() => {
      stream.push(progressEvent())
    })
    expect(store.get(difyBuilderExecutionProgressAtom)?.revision).toBe(4)

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await startPromise).toBe(true)
    })
    expect(store.get(difyBuilderExecutionProgressAtom)).toBeNull()
  })

  it('buffers reasoning separately and clears transient streams on command completion', async () => {
    const started = createSessionView()
    const terminal = createSessionView({
      version: 2,
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
      stream.push(reasoningEvent('Inspecting ', { revision: 1 }))
      stream.push(reasoningEvent('the failure.', { revision: 2 }))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())
    act(flushAnimationFrames)

    expect(store.get(difyBuilderReasoningAtom)?.text).toBe('Inspecting the failure.')
    expect(store.get(difyBuilderExecutionProgressAtom)?.execution.activities).toHaveLength(1)

    act(() => {
      stream.push(reasoningEvent('stale', { revision: 1 }))
    })
    act(flushAnimationFrames)
    expect(store.get(difyBuilderReasoningAtom)?.text).toBe('Inspecting the failure.')

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await startPromise).toBe(true)
    })
    expect(store.get(difyBuilderReasoningAtom)).toBeNull()
    expect(store.get(difyBuilderExecutionProgressAtom)).toBeNull()
  })

  it('clears execution progress and reasoning when the server terminates with an error', async () => {
    const stream = createControlledEventStream()
    clientMocks.create.mockResolvedValue(stream.iterable)
    clientMocks.get.mockResolvedValue(
      createSessionView({
        run_status: 'waiting_input',
      }),
    )
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startFix('app-1', 'run-1')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))

    act(() => {
      stream.push(commandStartedEvent(createSessionView()))
      stream.push(progressEvent())
      stream.push(reasoningEvent('Inspecting the failure'))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())
    act(flushAnimationFrames)
    expect(store.get(difyBuilderExecutionProgressAtom)).not.toBeNull()
    expect(store.get(difyBuilderReasoningAtom)).not.toBeNull()

    await act(async () => {
      stream.push({ event: 'error', data: { message: 'step failed' } })
      expect(await startPromise).toBe(false)
    })

    expect(store.get(difyBuilderExecutionProgressAtom)).toBeNull()
    expect(store.get(difyBuilderReasoningAtom)).toBeNull()
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('step failed')
  })

  it('recovers a transport failure when GET confirms the command id and version', async () => {
    const initial = createSessionView()
    const reconciled = createSessionView({
      version: 2,
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
    const contextItem = {
      seq: 0,
      at_version: 1,
      kind: 'run_context' as const,
      payload: {
        run_id: 'run-1',
        error_code: 'failed',
        title: 'Failed run',
        message: 'Run failed',
      },
    }
    const errorItem = {
      seq: 1,
      at_version: 2,
      kind: 'assistant_turn' as const,
      payload: {
        turn_id: 'command-1',
        execution: { status: 'error' as const },
        reasoning_text: undefined,
        reply_text:
          'The operation could not be completed. Restart from the current draft to continue.',
        cards: [],
      },
    }
    const failed = createSessionView({
      version: 2,
      run_status: 'failed',
      actions: [{ id: 'restart', label: 'Restart from current draft', kind: 'primary' }],
      conversation_last_seq: 1,
    })
    clientMocks.create.mockResolvedValue(
      streamOf(
        commandStartedEvent(createSessionView()),
        conversationItemEvent(contextItem),
        agentMessageEvent(errorItem.payload.reply_text, 1, {
          at_version: 2,
          seq: 1,
          text_bytes: new TextEncoder().encode(errorItem.payload.reply_text).byteLength,
          turn_id: 'command-1',
        }),
        agentMessageEvent('', 2, {
          at_version: 2,
          done: true,
          execution: { status: 'error' },
          seq: 1,
          text_bytes: new TextEncoder().encode(errorItem.payload.reply_text).byteLength,
          turn_id: 'command-1',
        }),
        stateEvent(failed),
      ),
    )
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startFix('app-1', 'run-1')
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())
    act(() => {
      flushAnimationFrames()
      flushAnimationFrames()
      flushAnimationFrames()
      flushAnimationFrames()
      flushAnimationFrames()
    })
    await act(async () => {
      expect(await startPromise).toBe(false)
    })

    expect(store.get(difyBuilderSessionViewAtom)).toEqual(failed)
    expect(store.get(difyBuilderConversationAtom)).toEqual([contextItem, errorItem])
    expect(clientMocks.conversation).not.toHaveBeenCalled()
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })
})

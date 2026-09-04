import type { ConversationItem } from '../../types'
import { act, waitFor } from '@testing-library/react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import {
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
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

describe('useDifyBuilderSessionController lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clientMocks.conversation.mockResolvedValue(conversationPage())
  })

  it('starts a session through the generated client and consumes typed events', async () => {
    const started = createSessionView()
    const notice = {
      seq: 1,
      at_version: 2,
      kind: 'notice' as const,
      payload: { text: 'Repair plan ready' },
    }
    const terminal = createSessionView({
      version: 3,
      state: 'fix.await_approval',
      canvas_read_only: false,
      run_status: 'waiting_input',
      conversation_last_seq: 1,
    })
    clientMocks.conversation
      .mockResolvedValueOnce(conversationPage())
      .mockResolvedValueOnce(conversationPage([notice]))
    clientMocks.create.mockResolvedValue(
      streamOf(
        commandStartedEvent(started),
        {
          event: 'canvas',
          data: {
            kind: 'canvas',
            session_id: 'session-1',
            operation_id: 'stale-operation',
            stage_id: 'fix.diagnose',
            at_version: 1,
            revision: 1,
            event: 'focus_workflow',
          },
        },
        {
          event: 'canvas',
          data: {
            kind: 'canvas',
            session_id: 'session-1',
            operation_id: 'operation-1',
            stage_id: 'fix.diagnose',
            at_version: 2,
            revision: 1,
            event: 'add_llm_node',
            node_id: 'node-1',
          },
        },
        {
          event: 'canvas',
          data: {
            kind: 'canvas',
            session_id: 'session-1',
            operation_id: 'operation-1',
            stage_id: 'fix.diagnose',
            at_version: 2,
            revision: 1,
            event: 'add_llm_node',
            node_id: 'node-1',
          },
        },
        {
          event: 'canvas',
          data: {
            kind: 'canvas',
            session_id: 'session-1',
            operation_id: 'operation-2',
            stage_id: 'fix.apply',
            at_version: 3,
            revision: 1,
            event: 'focus_workflow',
          },
        },
        {
          event: 'canvas',
          data: {
            kind: 'canvas',
            session_id: 'session-1',
            operation_id: 'operation-1',
            stage_id: 'fix.diagnose',
            at_version: 2,
            revision: 2,
            event: 'add_llm_node',
            node_id: 'stale-node',
          },
        },
        stateEvent(terminal),
      ),
    )
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.startFix('app-1', 'run-1')).toBe(true)
    })

    expect(clientMocks.create).toHaveBeenCalledWith(
      {
        body: {
          app_id: 'app-1',
          scenario: 'fix',
          failed_run_id: 'run-1',
        },
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderSessionLastCanvasEventAtom)).toEqual({
      id: 2,
      data: {
        kind: 'canvas',
        session_id: 'session-1',
        operation_id: 'operation-2',
        stage_id: 'fix.apply',
        at_version: 3,
        revision: 1,
        event: 'focus_workflow',
      },
    })
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
    expect(store.get(difyBuilderConversationAtom)).toEqual([notice])
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
  })

  it('merges commits by sequence and waits for the terminal state', async () => {
    const initial = {
      seq: 0,
      at_version: 1,
      kind: 'notice' as const,
      payload: { text: 'Starting diagnosis' },
    }
    const started = createSessionView({ conversation_last_seq: 0 })
    const committed = {
      seq: 1,
      at_version: 2,
      kind: 'notice' as const,
      payload: { text: 'Diagnosis complete' },
    }
    const terminal = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
      conversation_last_seq: 1,
    })
    const stream = createControlledEventStream()
    clientMocks.conversation.mockResolvedValue(conversationPage([initial]))
    clientMocks.create.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startFix('app-1', 'run-1')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))
    act(() => {
      stream.push(commandStartedEvent(started))
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
          items: [committed],
        },
      })
    })

    await waitFor(() => expect(store.get(difyBuilderSessionViewAtom)?.version).toBe(2))
    expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0, 1])
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(true)

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await startPromise).toBe(true)
    })
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
  })

  it('accepts command-started-only streams for settle-only actions', async () => {
    const waiting = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    const updated = createSessionView({
      ...waiting,
      version: 3,
      model: { provider: 'openai', name: 'gpt-5' },
    })
    clientMocks.action.mockResolvedValue(streamOf(commandStartedEvent(updated)))
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    await act(async () => {
      expect(await result.current.updateModel({ provider: 'openai', name: 'gpt-5' })).toBe(true)
    })

    expect(clientMocks.action.mock.calls[0]?.[0]).toEqual({
      params: { session_id: 'session-1' },
      body: {
        action_id: 'update_model',
        payload: { model_config: { provider: 'openai', name: 'gpt-5' } },
        base_version: 2,
        base_app_revision: 'revision-1',
      },
    })
    expect(store.get(difyBuilderSessionViewAtom)?.model?.name).toBe('gpt-5')
  })

  it('reconciles command failures through the generated JSON GET', async () => {
    const waiting = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    const latest = createSessionView({ ...waiting, version: 3, state: 'fix.await_verify' })
    clientMocks.action.mockRejectedValue({
      status: 409,
      data: { status: 409, body: { code: 'conflict' } },
    })
    clientMocks.get.mockResolvedValue(latest)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    await act(async () => {
      expect(await result.current.runAction('approve_plan')).toBe(false)
    })

    expect(clientMocks.get).toHaveBeenCalledWith(
      { params: { session_id: 'session-1' } },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(latest)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('HTTP 409: conflict')
  })

  it('accepts an unexpected command EOF when GET confirms a durable advance', async () => {
    const started = createSessionView()
    const latest = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    clientMocks.create.mockResolvedValue(streamOf(commandStartedEvent(started)))
    clientMocks.get.mockResolvedValue(latest)
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.startBuild('app-1', 'Build a support workflow')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(latest)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })

  it('rejects an unexpected command EOF when reconciliation shows no advance', async () => {
    const started = createSessionView()
    const unchanged = createSessionView({
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    clientMocks.create.mockResolvedValue(streamOf(commandStartedEvent(started)))
    clientMocks.get.mockResolvedValue(unchanged)
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.startBuild('app-1', 'Build a support workflow')).toBe(false)
    })

    expect(store.get(difyBuilderSessionViewAtom)).toEqual(unchanged)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toContain('terminal event')
  })

  it('does not treat another command version as success after an existing action EOF', async () => {
    const waiting = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    const advancedByAnotherCommand = createSessionView({ ...waiting, version: 3 })
    clientMocks.action.mockResolvedValue(streamOf(commandStartedEvent(waiting)))
    clientMocks.get.mockResolvedValue(advancedByAnotherCommand)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    await act(async () => {
      expect(await result.current.runAction('approve_plan')).toBe(false)
    })

    expect(store.get(difyBuilderSessionViewAtom)).toEqual(advancedByAnotherCommand)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toContain('terminal event')
  })

  it('restores JSON state and resumes an executing session through the reconnect stream', async () => {
    const executing = createSessionView({ session_id: 'session-restored', version: 3 })
    const terminal = createSessionView({
      ...executing,
      version: 4,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    clientMocks.get.mockResolvedValue(executing)
    clientMocks.stream.mockResolvedValue(
      streamOf(commandStartedEvent(executing), stateEvent(terminal)),
    )
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('  session-restored  ')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(clientMocks.get).toHaveBeenCalledWith(
      { params: { session_id: 'session-restored' } },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(clientMocks.stream).toHaveBeenCalledWith(
      { params: { session_id: 'session-restored' } },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
  })

  it('keeps a thinking restore stream open until the authoritative state arrives', async () => {
    const thinking = createSessionView({
      session_id: 'session-restored',
      run_status: 'processing',
      version: 3,
    })
    const terminal = createSessionView({
      ...thinking,
      version: 4,
      state: 'fix.await_approval',
      run_status: 'waiting_confirmation',
    })
    clientMocks.get.mockResolvedValue(thinking)
    clientMocks.stream.mockResolvedValue(
      streamOf(commandStartedEvent(thinking), stateEvent(terminal)),
    )
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
  })

  it('retries a restore when an active GET stream ends before a state frame', async () => {
    const executing = createSessionView({
      session_id: 'session-restored',
      run_status: 'processing',
      version: 3,
    })
    const waiting = createSessionView({
      ...executing,
      version: 4,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    clientMocks.get.mockResolvedValueOnce(executing).mockResolvedValueOnce(waiting)
    clientMocks.stream.mockResolvedValueOnce(streamOf(commandStartedEvent(executing)))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledTimes(2)
    expect(clientMocks.stream).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(waiting)
  })

  it('retries a transient restore request failure', async () => {
    const waiting = createSessionView({
      session_id: 'session-restored',
      state: 'fix.await_approval',
      run_status: 'waiting_confirmation',
    })
    clientMocks.get
      .mockRejectedValueOnce({ status: 503, data: { status: 503 } })
      .mockResolvedValueOnce(waiting)
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledTimes(2)
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(waiting)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })

  it('restores an interrupted working state from JSON without opening SSE', async () => {
    const interrupted = createSessionView({
      actions: [{ id: 'restart', label: 'Restart from current draft', kind: 'primary' }],
      interrupted: true,
      session_id: 'session-restored',
      state: 'fix.verify',
      run_status: 'processing',
      version: 3,
    })
    clientMocks.get.mockResolvedValue(interrupted)
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(clientMocks.stream).not.toHaveBeenCalled()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(interrupted)
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-restored')
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })

  it('restores the latest history page and prepends an older complete group', async () => {
    const olderGroup: ConversationItem[] = [
      {
        seq: 0,
        at_version: 1,
        kind: 'form' as const,
        payload: { variant: 'testdata' as const, fields: [], values: {} },
      },
      {
        seq: 1,
        at_version: 1,
        kind: 'assistant_turn' as const,
        payload: {
          turn_id: 'turn-1',
          stage_id: 'build.await_testdata',
          execution: { status: 'completed' },
          reply_text: 'Provide test data.',
          cards: ['form'],
        },
      },
    ]
    const latestItem = {
      seq: 2,
      at_version: 2,
      kind: 'notice' as const,
      payload: { text: 'Waiting for input' },
    }
    const view = createSessionView({
      conversation_last_seq: 2,
      run_status: 'waiting_input',
      state: 'build.await_testdata',
    })
    clientMocks.get.mockResolvedValue(view)
    clientMocks.conversation
      .mockResolvedValueOnce(conversationPage([latestItem], true))
      .mockResolvedValueOnce(conversationPage(olderGroup))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-1')).toBe(true)
    })
    expect(store.get(difyBuilderConversationAtom)).toEqual([latestItem])
    expect(store.get(difyBuilderConversationHasMoreAtom)).toBe(true)

    await act(async () => {
      expect(await result.current.loadOlderConversation()).toBe(true)
    })

    expect(clientMocks.conversation).toHaveBeenLastCalledWith(
      {
        params: { session_id: 'session-1' },
        query: { before_seq: 2, limit: 20 },
      },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0, 1, 2])
    expect(store.get(difyBuilderConversationHasMoreAtom)).toBe(false)
  })

  it('bounds restored history to the session snapshot sequence', async () => {
    const snapshotItem = {
      seq: 2,
      at_version: 2,
      kind: 'notice' as const,
      payload: { text: 'Snapshot item' },
    }
    const futureItem = {
      seq: 3,
      at_version: 3,
      kind: 'notice' as const,
      payload: { text: 'Future item' },
    }
    const view = createSessionView({
      conversation_last_seq: 2,
      run_status: 'waiting_input',
      state: 'fix.await_approval',
      version: 2,
    })
    clientMocks.get.mockResolvedValue(view)
    clientMocks.conversation.mockResolvedValue(conversationPage([snapshotItem, futureItem]))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-1')).toBe(true)
    })

    expect(clientMocks.conversation).toHaveBeenCalledWith(
      {
        params: { session_id: 'session-1' },
        query: { before_seq: 3, limit: 20 },
      },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderConversationAtom)).toEqual([snapshotItem])
  })

  it('clears a persisted pointer after a definitive restore failure', async () => {
    clientMocks.get.mockRejectedValue({
      status: 404,
      data: { status: 404, body: { code: 'not_found' } },
    })
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-gone')).toBe(false)
    })

    expect(store.get(difyBuilderActiveSessionIdAtom)).toBeNull()
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('HTTP 404: not_found')
  })
})

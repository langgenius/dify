import { act, waitFor } from '@testing-library/react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import {
  createControlledEventStream,
  createSessionView,
  renderSessionHook,
  snapshotEvent,
  stateEvent,
  streamOf,
} from './fixtures'

const clientMocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
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
          actions: { post: clientMocks.action },
          messages: { post: clientMocks.message },
        },
      },
    },
  },
}))

describe('useDifyBuilderSessionController lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a session through the generated client and consumes typed events', async () => {
    const snapshot = createSessionView()
    const terminal = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      canvas_read_only: false,
      run_status: 'waiting_input',
      conversation: [
        {
          seq: 1,
          at_version: 2,
          kind: 'notice',
          payload: { text: 'Repair plan ready' },
        },
      ],
    })
    clientMocks.create.mockResolvedValue(
      streamOf(
        snapshotEvent(snapshot),
        {
          event: 'canvas',
          data: { kind: 'canvas', event: 'add_llm_node', node_id: 'node-1' },
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
      id: 1,
      data: { kind: 'canvas', event: 'add_llm_node', node_id: 'node-1' },
    })
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
  })

  it('merges commits by sequence and waits for the terminal state', async () => {
    const snapshot = createSessionView({
      conversation: [
        { seq: 0, at_version: 1, kind: 'notice', payload: { text: 'Starting diagnosis' } },
      ],
    })
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
      conversation: [...snapshot.conversation, committed],
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
      stream.push(snapshotEvent(snapshot))
      stream.push({
        event: 'commit',
        data: {
          kind: 'commit',
          session_id: 'session-1',
          version: 2,
          state: 'fix.await_approval',
          settled: true,
          items: [committed],
        },
      })
    })

    await waitFor(() => expect(store.get(difyBuilderSessionViewAtom)?.version).toBe(2))
    expect(store.get(difyBuilderSessionViewAtom)?.conversation.map((item) => item.seq)).toEqual([
      0, 1,
    ])
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(true)

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await startPromise).toBe(true)
    })
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
  })

  it('accepts snapshot-only streams for settle-only actions', async () => {
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
    clientMocks.action.mockResolvedValue(streamOf(snapshotEvent(updated)))
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

  it('reconciles command failures through the generated GET stream', async () => {
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
    clientMocks.get.mockResolvedValue(streamOf(snapshotEvent(latest)))
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

  it('reconciles an unexpected command EOF through GET SSE', async () => {
    const snapshot = createSessionView()
    const latest = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    clientMocks.create.mockResolvedValue(streamOf(snapshotEvent(snapshot)))
    clientMocks.get.mockResolvedValue(streamOf(snapshotEvent(latest)))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.startBuild('app-1', 'Build a support workflow')).toBe(false)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(latest)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toContain('terminal event')
  })

  it('restores and resumes an executing session with one GET SSE request', async () => {
    const executing = createSessionView({ session_id: 'session-restored', version: 3 })
    const terminal = createSessionView({
      ...executing,
      version: 4,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    clientMocks.get.mockResolvedValue(streamOf(snapshotEvent(executing), stateEvent(terminal)))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('  session-restored  ')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(clientMocks.get).toHaveBeenCalledWith(
      { params: { session_id: 'session-restored' } },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
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

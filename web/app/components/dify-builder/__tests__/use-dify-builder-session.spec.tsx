import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ReactNode } from 'react'
import type { SessionView } from '../types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import { useDifyBuilderSession } from '../use-dify-builder-session'

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

const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  session_id: 'session-1',
  app_id: 'app-1',
  version: 1,
  state: 'fix.diagnose',
  canvas_read_only: true,
  run_status: 'executing',
  interrupted: false,
  conversation: [],
  app_revision: { observed: 'revision-1', current: 'revision-1', conflicted: false },
  ...overrides,
})

const snapshotEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'snapshot',
  data: view,
})

const stateEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'state',
  data: { kind: 'state', ...view },
})

async function* streamOf(
  ...events: DifyBuilderStreamEventResponse[]
): AsyncGenerator<DifyBuilderStreamEventResponse> {
  yield* events
}

type ControlledItem =
  | { event: DifyBuilderStreamEventResponse }
  | { done: true }
  | { error: unknown }

const createControlledEventStream = () => {
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

const renderSessionHook = () => {
  const store = createStore()
  const rendered = renderHook(() => useDifyBuilderSession(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  })
  return { ...rendered, store }
}

describe('useDifyBuilderSession', () => {
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
    expect(result.current.progressLog.map(({ event }) => event)).toEqual([
      'snapshot',
      'canvas',
      'state',
    ])
    expect(store.get(difyBuilderSessionLastCanvasEventAtom)).toEqual({
      id: 1,
      data: { kind: 'canvas', event: 'add_llm_node', node_id: 'node-1' },
    })
    expect(result.current.view).toEqual(terminal)
    expect(result.current.isBusy).toBe(false)
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
    const { result } = renderSessionHook()

    let startPromise: Promise<boolean> | undefined
    act(() => {
      startPromise = result.current.startFix('app-1', 'run-1')
    })
    await waitFor(() => expect(result.current.isBusy).toBe(true))
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

    await waitFor(() => expect(result.current.view?.version).toBe(2))
    expect(result.current.view?.conversation.map((item) => item.seq)).toEqual([0, 1])
    expect(result.current.isBusy).toBe(true)

    await act(async () => {
      stream.push(stateEvent(terminal))
      expect(await startPromise).toBe(true)
    })
    expect(result.current.isBusy).toBe(false)
  })

  it('renders assistant deltas before applying the authoritative state', async () => {
    const waiting = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      run_status: 'waiting_input',
    })
    const terminal = createSessionView({
      ...waiting,
      version: 4,
      conversation: [
        {
          seq: 1,
          at_version: 4,
          kind: 'assistant_turn',
          payload: {
            turn_id: 'turn-1',
            stage_id: 'fix.await_approval',
            trace: { status: 'completed' },
            reply_text: 'A smaller repair',
          },
        },
      ],
    })
    clientMocks.message.mockResolvedValue(
      streamOf(
        snapshotEvent(waiting),
        {
          event: 'agent_message',
          data: {
            kind: 'agent_message',
            session_id: 'session-1',
            id: 'turn-1',
            answer: 'A smaller repair',
            seq: 1,
            at_version: 4,
            stage_id: 'fix.await_approval',
          },
        },
        stateEvent(terminal),
      ),
    )
    const { result, store } = renderSessionHook()
    act(() => store.set(difyBuilderSessionViewAtom, waiting))
    act(() => store.set(difyBuilderActiveSessionIdAtom, waiting.session_id))

    await act(async () => {
      expect(await result.current.sendMessage('  Try a smaller repair  ')).toBe(true)
    })

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
    expect(result.current.view).toEqual(terminal)
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
    act(() => store.set(difyBuilderSessionViewAtom, waiting))
    act(() => store.set(difyBuilderActiveSessionIdAtom, waiting.session_id))

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
    expect(result.current.view?.model?.name).toBe('gpt-5')
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
    act(() => store.set(difyBuilderSessionViewAtom, waiting))
    act(() => store.set(difyBuilderActiveSessionIdAtom, waiting.session_id))

    await act(async () => {
      expect(await result.current.runAction('approve_plan')).toBe(false)
    })

    expect(clientMocks.get).toHaveBeenCalledWith(
      { params: { session_id: 'session-1' } },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(result.current.view).toEqual(latest)
    expect(result.current.lastError).toBe('HTTP 409: conflict')
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
    const { result } = renderSessionHook()

    await act(async () => {
      expect(await result.current.startBuild('app-1', 'Build a support workflow')).toBe(false)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(result.current.view).toEqual(latest)
    expect(result.current.lastError).toContain('terminal event')
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
    const { result } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('  session-restored  ')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(clientMocks.get).toHaveBeenCalledWith(
      { params: { session_id: 'session-restored' } },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(result.current.view).toEqual(terminal)
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
    expect(result.current.lastError).toBe('HTTP 404: not_found')
  })

  it('aborts an in-flight generated client call when reset', async () => {
    clientMocks.create.mockImplementation(
      (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason))
        }),
    )
    const { result, store } = renderSessionHook()

    let startPromise: Promise<boolean> | undefined
    act(() => {
      startPromise = result.current.startBuild('app-1', 'Build a support workflow')
    })
    await waitFor(() => expect(result.current.isBusy).toBe(true))

    act(() => result.current.reset())

    await act(async () => {
      expect(await startPromise).toBe(false)
    })
    expect(result.current.isBusy).toBe(false)
    expect(result.current.lastError).toBe('')
    expect(store.get(difyBuilderSessionLastCanvasEventAtom)).toBeNull()
  })
})

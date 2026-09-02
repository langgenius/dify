import { act, waitFor } from '@testing-library/react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderStreamingTurnAtom,
} from '../state'
import {
  agentMessageEvent,
  createControlledEventStream,
  createSessionView,
  installAnimationFrameMock,
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

describe('useDifyBuilderSessionController streaming', () => {
  let flushAnimationFrames: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    flushAnimationFrames = installAnimationFrameMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('coalesces assistant deltas per frame and lets authoritative events replace them', async () => {
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
    const stream = createControlledEventStream()
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
      stream.push(snapshotEvent({ ...waiting }))
    })
    await waitFor(() => expect(store.get(difyBuilderSessionViewAtom)).not.toBe(waiting))
    const committedViewListener = vi.fn()
    const unsubscribe = store.sub(difyBuilderSessionViewAtom, committedViewListener)

    act(() => {
      stream.push(agentMessageEvent('A '))
      stream.push(agentMessageEvent('smaller '))
      stream.push(agentMessageEvent('repair'))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())

    expect(store.get(difyBuilderSessionViewAtom)?.conversation).toEqual([])
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    act(flushAnimationFrames)
    expect(store.get(difyBuilderStreamingTurnAtom)?.replyText).toBe('A smaller repair')
    expect(store.get(difyBuilderSessionViewAtom)?.conversation).toEqual([])
    expect(committedViewListener).not.toHaveBeenCalled()

    act(() => {
      stream.push({
        event: 'commit',
        data: {
          kind: 'commit',
          session_id: 'session-1',
          version: 4,
          state: 'fix.await_approval',
          settled: true,
          items: terminal.conversation,
        },
      })
    })
    await waitFor(() => expect(store.get(difyBuilderSessionViewAtom)?.version).toBe(4))
    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderSessionViewAtom)?.conversation).toEqual(terminal.conversation)
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

  it('clears stale streaming state when switching sessions', async () => {
    const restored = createSessionView({
      session_id: 'session-restored',
      run_status: 'waiting_input',
      state: 'fix.await_approval',
    })
    clientMocks.get.mockResolvedValue(streamOf(snapshotEvent(restored)))
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderStreamingTurnAtom, {
        sessionId: 'session-old',
        turnId: 'turn-old',
        sequence: 1,
        atVersion: 2,
        stageId: 'fix.diagnose',
        replyText: 'stale',
      })
    })

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(store.get(difyBuilderStreamingTurnAtom)).toBeNull()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(restored)
  })

  it('aborts an in-flight stream and cancels its pending frame when reset', async () => {
    const snapshot = createSessionView()
    const stream = createControlledEventStream()
    clientMocks.create.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()

    let startPromise!: Promise<boolean>
    act(() => {
      startPromise = result.current.startBuild('app-1', 'Build a support workflow')
    })
    await waitFor(() => expect(store.get(difyBuilderSessionBusyAtom)).toBe(true))
    act(() => {
      stream.push(snapshotEvent(snapshot))
      stream.push(agentMessageEvent('Partial response'))
    })
    await waitFor(() => expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce())

    act(() => result.current.reset())
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledOnce()
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
})

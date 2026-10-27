import type { DifyBuilderTaskControlPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import { act, waitFor } from '@testing-library/react'
import { difyBuilderCanvasAppliedViewAtom, difyBuilderDraftAtom } from '../../store'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from '../state'
import {
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  renderSessionHook,
  stateEvent,
} from './fixtures'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  conversation: vi.fn(),
  stream: vi.fn(),
  stop: vi.fn(),
  resume: vi.fn(),
  action: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => ({
  consoleQuery: (await importOriginal<typeof import('@/service/console')>()).consoleQuery,
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: api.create,
        bySessionId: {
          get: api.get,
          conversation: { get: api.conversation },
          stream: { get: api.stream },
          stop: { post: api.stop },
          resume: { post: api.resume },
          actions: { post: api.action },
        },
      },
    },
  },
}))

const pausedView = (version = 6) =>
  createSessionView({ version, run_status: 'paused', canvas_read_only: false, actions: [] })

const seedSession = (
  store: ReturnType<typeof renderSessionHook>['store'],
  view = createSessionView({ version: 4 }),
) => {
  act(() => {
    store.set(difyBuilderActiveSessionIdAtom, view.session_id)
    store.set(difyBuilderSessionViewAtom, view)
    store.set(difyBuilderCanvasAppliedViewAtom, {
      sessionId: view.session_id,
      version: view.version,
    })
    store.set(difyBuilderDraftAtom, 'Keep this unsent draft')
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  api.conversation.mockResolvedValue(conversationPage())
})

afterEach(() => vi.useRealTimers())

it('stops planning through the independent JSON endpoint while the first response is busy', async () => {
  const response = createControlledEventStream()
  api.create.mockResolvedValue(response.iterable)
  api.get.mockResolvedValue(pausedView())
  let acknowledge!: (view: ReturnType<typeof createSessionView>) => void
  api.stop.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve
      }),
  )
  const prepare = vi.fn(async () => {})
  const { result, store } = renderSessionHook(prepare)
  let building!: Promise<boolean>
  act(() => {
    building = result.current.startBuild('app-1', 'Build an assistant')
  })
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  act(() => response.push(commandStartedEvent(createSessionView({ version: 4 }))))
  await waitFor(() => expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1'))

  let stopping!: Promise<boolean>
  act(() => {
    stopping = result.current.stopTask()
  })
  await waitFor(() => expect(api.stop).toHaveBeenCalledOnce())
  expect(store.get(difyBuilderTaskControlAtom)).toEqual({ operation: 'stop', phase: 'pending' })
  expect(await result.current.stopTask()).toBe(false)
  expect(api.stop).toHaveBeenCalledWith(
    {
      params: { session_id: 'session-1' },
      body: { base_version: 4, client_action_id: expect.any(String) },
    },
    { context: { silent: true }, signal: expect.any(AbortSignal) },
  )
  expect(api.create.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(api.stop.mock.calls[0]![1].signal.aborted).toBe(false)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(api.action).not.toHaveBeenCalled()

  await act(async () => {
    acknowledge(createSessionView({ version: 5 }))
    expect(await stopping).toBe(true)
    response.push(stateEvent(createSessionView({ version: 4 })))
    response.close()
    await building
  })
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(pausedView())
  expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
  expect(store.get(difyBuilderTaskControlAtom)).toBeNull()
})

it('keeps stopping until the latest GET confirms settlement, independently of the ACK', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { result, store } = renderSessionHook()
  seedSession(store)
  let finishSettlement!: (view: ReturnType<typeof createSessionView>) => void
  api.stop.mockImplementation(async ({ body }: { body: DifyBuilderTaskControlPayload }) => {
    api.get
      .mockResolvedValueOnce(
        createSessionView({ version: 5, last_command_id: body.client_action_id }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSettlement = resolve
          }),
      )
    return pausedView(5)
  })
  let stopping!: Promise<boolean>
  await act(async () => {
    stopping = result.current.stopTask()
  })
  expect(store.get(difyBuilderSessionViewAtom)?.canvas_read_only).toBe(true)
  expect(store.get(difyBuilderSessionViewAtom)?.run_status).toBe('processing')
  expect(store.get(difyBuilderTaskControlAtom)?.phase).toBe('pending')

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(store.get(difyBuilderTaskControlAtom)?.phase).toBe('pending')
  await act(async () => {
    finishSettlement(pausedView())
    expect(await stopping).toBe(true)
  })
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(pausedView())
})

it('saves pause-period changes before reading the latest version and resuming the same task', async () => {
  let finishSaving!: () => void
  const prepare = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve
      }),
  )
  const { result, store } = renderSessionHook(prepare)
  seedSession(store, pausedView())
  const saved = pausedView(9)
  saved.app_revision = { current: 'saved-code-edges-and-variables', conflicted: true }
  const running = createSessionView({ version: 11 })
  const continued = createSessionView({
    version: 12,
    run_status: 'waiting_input',
    canvas_read_only: false,
  })
  const events = createControlledEventStream()
  api.get.mockResolvedValueOnce(saved).mockResolvedValue(running)
  api.resume.mockResolvedValue(createSessionView({ version: 10 }))
  api.stream.mockResolvedValue(events.iterable)
  let resuming!: Promise<boolean>
  act(() => {
    resuming = result.current.resumeTask()
  })
  expect(prepare).toHaveBeenCalledWith(true, expect.any(AbortSignal))
  expect(store.get(difyBuilderTaskControlAtom)?.phase).toBe('saving')
  expect(api.get).not.toHaveBeenCalled()
  expect(api.resume).not.toHaveBeenCalled()

  act(() => finishSaving())
  await waitFor(() => expect(api.stream).toHaveBeenCalledOnce())
  expect(api.resume).toHaveBeenCalledExactlyOnceWith(
    {
      params: { session_id: 'session-1' },
      body: {
        base_version: 9,
        base_app_revision: 'saved-code-edges-and-variables',
        client_action_id: expect.any(String),
      },
    },
    { context: { silent: true }, signal: expect.any(AbortSignal) },
  )
  expect(store.get(difyBuilderTaskControlAtom)).toBeNull()
  expect(store.get(difyBuilderDraftAtom)).toBe('Keep this unsent draft')
  expect(api.create).not.toHaveBeenCalled()
  expect(api.action).not.toHaveBeenCalled()
  await act(async () => {
    events.push(stateEvent(continued))
    expect(await resuming).toBe(true)
  })
  expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(continued)
})

it('keeps edits and the paused session when saving fails, without submitting Resume', async () => {
  const { result, store } = renderSessionHook(vi.fn().mockRejectedValue(new Error('Save failed')))
  seedSession(store, pausedView())
  await act(async () => {
    expect(await result.current.resumeTask()).toBe(false)
  })
  expect(api.get).not.toHaveBeenCalled()
  expect(api.resume).not.toHaveBeenCalled()
  expect(store.get(difyBuilderDraftAtom)).toBe('Keep this unsent draft')
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(pausedView())
  expect(store.get(difyBuilderTaskControlAtom)).toBeNull()
  expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('Save failed')
})

it('retries an uncertain Stop with the identical body and ignores its old ACK', async () => {
  const { result, store } = renderSessionHook()
  seedSession(store)
  api.stop.mockRejectedValueOnce(new TypeError('Network unavailable'))
  await act(async () => {
    expect(await result.current.stopTask()).toBe(false)
  })
  expect(store.get(difyBuilderTaskControlAtom)?.phase).toBe('unknown')
  const originalBody = api.stop.mock.calls[0]![0].body
  const later = createSessionView({ version: 20, last_command_id: 'another-resume' })
  const current = createSessionView({
    version: 21,
    run_status: 'waiting_input',
    canvas_read_only: false,
  })
  api.get.mockResolvedValueOnce(later).mockResolvedValue(current)
  api.stop.mockResolvedValue(createSessionView({ version: 5 }))
  const observedVersions: number[] = []
  const unsubscribe = store.sub(difyBuilderSessionViewAtom, () => {
    observedVersions.push(store.get(difyBuilderSessionViewAtom)!.version)
  })
  await act(async () => {
    expect(await result.current.stopTask()).toBe(true)
  })
  unsubscribe()
  expect(api.stop.mock.calls[1]![0].body).toEqual(originalBody)
  expect(observedVersions).toEqual([20, 21])
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(current)
  expect(store.get(difyBuilderTaskControlAtom)).toBeNull()
})

it('reconciles a lost ACK without resending a Stop that already settled', async () => {
  const { result, store } = renderSessionHook()
  seedSession(store)
  api.stop.mockRejectedValueOnce(new TypeError('Network unavailable'))
  await act(async () => {
    await result.current.stopTask()
  })
  api.get.mockResolvedValue(pausedView())
  await act(async () => {
    expect(await result.current.stopTask()).toBe(true)
  })
  expect(api.stop).toHaveBeenCalledOnce()
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(pausedView())
})

it('refreshes a 409 conflict without automatically replaying the operation or clearing the draft', async () => {
  const { result, store } = renderSessionHook()
  seedSession(store)
  api.stop.mockRejectedValue(new Response(null, { status: 409 }))
  api.get.mockResolvedValue(pausedView(8))
  await act(async () => {
    expect(await result.current.stopTask()).toBe(false)
  })
  expect(api.stop).toHaveBeenCalledOnce()
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(pausedView(8))
  expect(store.get(difyBuilderDraftAtom)).toBe('Keep this unsent draft')
  expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('difyBuilder.taskControl.conflict')
  expect(store.get(difyBuilderTaskControlAtom)).toBeNull()
})

it('keeps failed cancellation read-only and retains the existing history', async () => {
  const { result, store } = renderSessionHook()
  seedSession(store)
  const history = [
    {
      seq: 0,
      at_version: 2,
      kind: 'user' as const,
      payload: { text: 'Original goal', turn_id: 'original-turn' },
    },
  ]
  act(() => store.set(difyBuilderConversationAtom, history))
  const failed = createSessionView({
    version: 7,
    run_status: 'failed',
    canvas_read_only: true,
    conversation_last_seq: 0,
  })
  api.stop.mockResolvedValue(pausedView())
  api.get.mockResolvedValue(failed)
  await act(async () => {
    expect(await result.current.stopTask()).toBe(false)
  })
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(failed)
  expect(store.get(difyBuilderConversationAtom)).toEqual(history)
  expect(await result.current.resumeTask()).toBe(false)
  expect(api.resume).not.toHaveBeenCalled()
})

it('does not restore an older processing command over an already observed pause', async () => {
  const { result, store } = renderSessionHook()
  seedSession(store, pausedView(20))
  api.get.mockResolvedValue(createSessionView({ version: 16 }))
  await act(async () => {
    expect(await result.current.restore('session-1')).toBe(true)
  })
  expect(store.get(difyBuilderSessionViewAtom)).toEqual(pausedView(20))
  expect(api.stream).not.toHaveBeenCalled()
})

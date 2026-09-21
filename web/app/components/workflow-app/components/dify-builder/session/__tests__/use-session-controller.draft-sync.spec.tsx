import { act } from '@testing-library/react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import {
  commandStartedEvent,
  conversationPage,
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

vi.mock('@/service/console', async (importOriginal) => ({
  consoleQuery: (await importOriginal<typeof import('@/service/console')>()).consoleQuery,
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

describe('Builder draft preparation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clientMocks.conversation.mockResolvedValue(conversationPage())
  })

  it.each(['start', 'action', 'message'] as const)(
    'waits for pending draft writes before %s',
    async (command) => {
      let finishSaving!: () => void
      const prepare = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishSaving = resolve
          }),
      )
      const { result, store } = renderSessionHook(prepare)
      const waiting = createSessionView({ run_status: 'waiting_input', canvas_read_only: false })
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      const endpoint =
        command === 'start'
          ? clientMocks.create
          : command === 'action'
            ? clientMocks.action
            : clientMocks.message
      endpoint.mockResolvedValue(streamOf(commandStartedEvent(waiting), stateEvent(waiting)))

      let request!: Promise<boolean>
      act(() => {
        request =
          command === 'start'
            ? result.current.startFix('app-1', 'run-1')
            : command === 'action'
              ? result.current.runAction('approve_plan')
              : result.current.sendMessage('Update the prompt')
      })
      expect(prepare).toHaveBeenCalledExactlyOnceWith(true, expect.any(AbortSignal))
      expect(store.get(difyBuilderSessionBusyAtom)).toBe(true)
      expect(endpoint).not.toHaveBeenCalled()
      expect(store.get(difyBuilderSessionViewAtom)).toEqual(waiting)

      await act(async () => {
        finishSaving()
        expect(await request).toBe(true)
      })
      expect(endpoint).toHaveBeenCalledOnce()
      expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    },
  )

  it.each(['start', 'action'] as const)(
    'preserves the session and makes no requests when %s preparation fails',
    async (command) => {
      const prepare = vi.fn().mockRejectedValue(new Error('Workflow draft sync failed.'))
      const { result, store } = renderSessionHook(prepare)
      const waiting = createSessionView({
        run_status: 'waiting_confirmation',
        canvas_read_only: false,
      })
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      await act(async () => {
        expect(
          await (command === 'start'
            ? result.current.startFix('app-1', 'run-1')
            : result.current.runAction('approve_plan')),
        ).toBe(false)
      })
      expect(clientMocks.create).not.toHaveBeenCalled()
      expect(clientMocks.action).not.toHaveBeenCalled()
      expect(clientMocks.get).not.toHaveBeenCalled()
      expect(store.get(difyBuilderSessionViewAtom)).toEqual(waiting)
      expect(store.get(difyBuilderActiveSessionIdAtom)).toBe(waiting.session_id)
      expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('Workflow draft sync failed.')
      expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    },
  )

  it('takes the barrier without saving an older canvas when restoring a session', async () => {
    let finishDraining!: () => void
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDraining = resolve
        }),
    )
    const { result } = renderSessionHook(prepare)
    clientMocks.get.mockResolvedValue(createSessionView({ run_status: 'waiting_input' }))
    let request!: Promise<boolean>
    act(() => {
      request = result.current.restore('session-1')
    })
    expect(prepare).toHaveBeenCalledExactlyOnceWith(false, expect.any(AbortSignal))
    expect(clientMocks.get).not.toHaveBeenCalled()
    await act(async () => {
      finishDraining()
      expect(await request).toBe(true)
    })
    expect(clientMocks.get).toHaveBeenCalledOnce()
  })
})

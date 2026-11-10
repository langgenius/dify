import type { SessionView } from '../../types'
import { act, waitFor } from '@testing-library/react'
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

const recoveryView = (overrides: Partial<SessionView> = {}) =>
  createSessionView({
    run_status: 'waiting_confirmation',
    canvas_read_only: false,
    actions: [
      {
        id: 'recovery_continue',
        kind: 'primary',
        label: 'Continue',
        payload: { recovery_id: 'recovery-1' },
      },
    ],
    active_interaction: { action_id: 'recovery_continue', card_seq: 4, valid_at_version: 1 },
    ...overrides,
  })

// Public UiAction emitted for a restartable recovery in service.py.
const restartAction = {
  id: 'restart',
  kind: 'secondary',
  label: { type: 'copy', id: 'actions.restartFromCurrentDraft' },
} satisfies NonNullable<SessionView['actions']>[number]

const recoveryChoices = ['check_recovery', 'recovery_continue', 'restart'].flatMap((selectedId) => [
  { selectedId, actionId: selectedId, payload: { note: 'original choice' } },
  {
    selectedId,
    actionId: 'confirm',
    payload: { option_id: selectedId, note: 'original choice' },
  },
])

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
            ? result.current.startBuild('app-1', 'Build a workflow')
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
      expect(clientMocks.get).not.toHaveBeenCalled()
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
            ? result.current.startBuild('app-1', 'Build a workflow')
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

  it.each(recoveryChoices)(
    'submits $actionId/$selectedId with the version and revision read after autosave, including its Trace',
    async ({ selectedId, actionId, payload }) => {
      let finishSaving!: () => void
      const prepare = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishSaving = resolve
          }),
      )
      const selectedAction: NonNullable<SessionView['actions']>[number] =
        selectedId === 'restart'
          ? restartAction
          : {
              id: selectedId,
              kind: 'primary',
              label: 'Continue',
              payload: { recovery_id: 'recovery-1' },
            }
      const waiting = recoveryView({
        actions: [selectedAction],
        active_interaction:
          selectedId === 'restart'
            ? null
            : { action_id: selectedId, card_seq: 4, valid_at_version: 1 },
      })
      const saved = createSessionView({
        ...waiting,
        version: 3,
        app_revision: { current: 'saved-revision', conflicted: true },
        active_interaction:
          selectedId === 'restart'
            ? null
            : { action_id: selectedId, card_seq: 4, valid_at_version: 3 },
      })
      const { result, store } = renderSessionHook(prepare)
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      clientMocks.get.mockResolvedValue(saved)
      clientMocks.action.mockResolvedValue(streamOf(commandStartedEvent(saved), stateEvent(saved)))
      let request!: Promise<boolean>
      act(() => {
        request = result.current.runAction(actionId, payload)
      })
      expect(clientMocks.get).not.toHaveBeenCalled()
      expect(clientMocks.action).not.toHaveBeenCalled()
      await act(async () => {
        finishSaving()
        expect(await request).toBe(true)
      })
      const expectedBody = {
        action_id: actionId,
        payload: { ...selectedAction.payload, ...payload },
        base_version: 3,
        base_app_revision: 'saved-revision',
      }
      expect(clientMocks.action.mock.calls[0]?.[0].body).toMatchObject(expectedBody)
      expect(clientMocks.get).toHaveBeenCalledOnce()
      expect(
        result.current
          .getTrace()
          .entries.find((entry) => entry.dir === 'out' && entry.kind === 'action')?.payload,
      ).toMatchObject(expectedBody)
    },
  )

  it.each(
    recoveryChoices
      .filter((choice) => choice.selectedId === 'restart')
      .flatMap((choice) =>
        ['removed choice', 'changed choice', 'session switch'].map((boundary) => ({
          ...choice,
          boundary,
        })),
      ),
  )(
    'rejects $actionId/restart after a $boundary during the fresh read',
    async ({ actionId, payload, boundary }) => {
      const waiting = recoveryView({ actions: [restartAction], active_interaction: null })
      const { result, store } = renderSessionHook(vi.fn().mockResolvedValue(undefined))
      let releaseRead!: (snapshot: SessionView) => void
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      clientMocks.get.mockImplementation(
        () =>
          new Promise<SessionView>((resolve) => {
            releaseRead = resolve
          }),
      )
      let request!: Promise<boolean>
      act(() => {
        request = result.current.runAction(actionId, payload)
      })
      await waitFor(() => expect(clientMocks.get).toHaveBeenCalledOnce())
      const replacement = createSessionView({ session_id: 'session-2' })
      if (boundary === 'session switch') {
        act(() => {
          store.set(difyBuilderSessionViewAtom, replacement)
          store.set(difyBuilderActiveSessionIdAtom, replacement.session_id)
        })
      }
      await act(async () => {
        releaseRead({
          ...waiting,
          version: 3,
          app_revision: { current: 'saved-revision', conflicted: true },
          actions:
            boundary === 'removed choice'
              ? []
              : boundary === 'changed choice'
                ? [{ ...restartAction, payload: { recovery_id: 'replacement' } }]
                : waiting.actions,
        })
        expect(await request).toBe(false)
      })
      expect(clientMocks.action).not.toHaveBeenCalled()
      expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
      expect(result.current.getTrace().entries.filter((entry) => entry.dir === 'out')).toEqual([])
      if (boundary === 'session switch')
        expect(store.get(difyBuilderSessionViewAtom)).toEqual(replacement)
    },
  )

  it('submits an unchanged recovery choice after the save barrier', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined)
    const waiting = recoveryView()
    const { result, store } = renderSessionHook(prepare)
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })
    clientMocks.get.mockResolvedValue(waiting)
    clientMocks.action.mockResolvedValue(
      streamOf(commandStartedEvent(waiting), stateEvent(waiting)),
    )
    await act(async () => {
      expect(await result.current.runAction('recovery_continue')).toBe(true)
    })
    expect(prepare).toHaveBeenCalledExactlyOnceWith(true, expect.any(AbortSignal))
    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(clientMocks.action.mock.calls[0]?.[0].body).toMatchObject({
      action_id: 'recovery_continue',
      base_version: 1,
      base_app_revision: 'revision-1',
      payload: { recovery_id: 'recovery-1' },
    })
  })

  it.each([
    ['removed action', { actions: [] }],
    [
      'changed choice label',
      {
        actions: [
          {
            id: 'recovery_continue',
            kind: 'primary',
            label: 'Different recovery choice',
            payload: { recovery_id: 'recovery-1' },
          },
        ],
      },
    ],
    [
      'changed action target',
      {
        actions: [
          {
            id: 'recovery_continue',
            kind: 'primary',
            label: 'Continue',
            payload: { recovery_id: 'replacement' },
          },
        ],
      },
    ],
    [
      'replacement card',
      { active_interaction: { action_id: 'recovery_continue', card_seq: 5, valid_at_version: 3 } },
    ],
    [
      'changed interaction action',
      { active_interaction: { action_id: 'restart', card_seq: 4, valid_at_version: 3 } },
    ],
    ['removed interaction', { active_interaction: null }],
    ['foreign session', { session_id: 'session-2' }],
  ] satisfies [string, Partial<SessionView>][])(
    'rejects a recovery choice after autosave returns a %s',
    async (_reason, overrides) => {
      const waiting = recoveryView()
      const { result, store } = renderSessionHook(vi.fn().mockResolvedValue(undefined))
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      clientMocks.get.mockResolvedValue(recoveryView({ version: 3, ...overrides }))
      await act(async () => {
        expect(await result.current.runAction('confirm', { option_id: 'recovery_continue' })).toBe(
          false,
        )
      })
      expect(clientMocks.action).not.toHaveBeenCalled()
      expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('difyBuilder.taskControl.conflict')
      expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
      expect(result.current.getTrace().entries.filter((entry) => entry.dir === 'out')).toEqual([])
    },
  )

  it.each(['save', 'read'] as const)(
    'does not post recovery when the %s fails',
    async (boundary) => {
      const prepare = vi.fn().mockResolvedValue(undefined)
      const error = new Error(`${boundary} failed`)
      if (boundary === 'save') prepare.mockRejectedValue(error)
      else clientMocks.get.mockRejectedValue(error)
      const waiting = recoveryView()
      const { result, store } = renderSessionHook(prepare)
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      await act(async () => {
        expect(await result.current.runAction('recovery_continue')).toBe(false)
      })
      expect(clientMocks.action).not.toHaveBeenCalled()
      expect(clientMocks.get).toHaveBeenCalledTimes(boundary === 'save' ? 0 : 1)
      expect(store.get(difyBuilderSessionViewAtom)).toEqual(waiting)
      expect(store.get(difyBuilderSessionLastErrorAtom)).toBe(error.message)
      expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    },
  )

  it.each([
    ['save', 'abort'],
    ['read', 'abort'],
    ['save', 'switch'],
    ['read', 'switch'],
  ] as const)(
    'does not post recovery after a session %s boundary and %s',
    async (boundary, transition) => {
      let releaseSave!: () => void
      let releaseRead!: (snapshot: SessionView) => void
      const prepare = vi.fn(() =>
        boundary === 'save'
          ? new Promise<void>((resolve) => {
              releaseSave = resolve
            })
          : Promise.resolve(),
      )
      const waiting = recoveryView()
      const replacement = createSessionView({ session_id: 'session-2' })
      const { result, store } = renderSessionHook(prepare)
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      clientMocks.get.mockImplementation(
        () =>
          new Promise<SessionView>((resolve) => {
            releaseRead = resolve
          }),
      )
      let request!: Promise<boolean>
      act(() => {
        request = result.current.runAction('recovery_continue')
      })
      if (boundary === 'read') await waitFor(() => expect(clientMocks.get).toHaveBeenCalledOnce())
      act(() => {
        if (transition === 'abort') result.current.reset()
        else {
          store.set(difyBuilderSessionViewAtom, replacement)
          store.set(difyBuilderActiveSessionIdAtom, replacement.session_id)
        }
      })
      await act(async () => {
        if (boundary === 'save') releaseSave()
        else releaseRead(recoveryView({ version: 3 }))
        expect(await request).toBe(false)
      })
      expect(clientMocks.action).not.toHaveBeenCalled()
      if (boundary === 'save') expect(clientMocks.get).not.toHaveBeenCalled()
      expect(store.get(difyBuilderSessionViewAtom)).toEqual(
        transition === 'abort' ? null : replacement,
      )
    },
  )

  it('does not overwrite a newer local choice with a delayed recovery snapshot', async () => {
    const waiting = recoveryView()
    let releaseRead!: (snapshot: SessionView) => void
    const { result, store } = renderSessionHook(vi.fn().mockResolvedValue(undefined))
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })
    clientMocks.get.mockImplementation(
      () =>
        new Promise<SessionView>((resolve) => {
          releaseRead = resolve
        }),
    )
    let request!: Promise<boolean>
    act(() => {
      request = result.current.runAction('recovery_continue')
    })
    await waitFor(() => expect(clientMocks.get).toHaveBeenCalledOnce())
    const newer = recoveryView({ version: 4, actions: [] })
    act(() => {
      store.set(difyBuilderSessionViewAtom, newer)
    })
    await act(async () => {
      releaseRead(recoveryView({ version: 3 }))
      expect(await request).toBe(false)
    })
    expect(clientMocks.action).not.toHaveBeenCalled()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(newer)
  })

  it.each(['confirm_test_operation', 'deny_test_operation', 'resume_test', 'cancel_test'])(
    'preserves immutable %s targets without autosave or a preparation GET',
    async (selectedId) => {
      const prepare = vi.fn().mockResolvedValue(undefined)
      const waiting = createSessionView({
        run_status: 'waiting_confirmation',
        actions: [
          {
            id: selectedId,
            kind: 'primary',
            label: 'Control',
            payload: { request_id: 'current-request' },
          },
        ],
      })
      const { result, store } = renderSessionHook(prepare)
      act(() => {
        store.set(difyBuilderSessionViewAtom, waiting)
        store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
      })
      clientMocks.action.mockResolvedValue(
        streamOf(commandStartedEvent(waiting), stateEvent(waiting)),
      )
      await act(async () => {
        expect(
          await result.current.runAction('confirm', {
            option_id: selectedId,
            request_id: 'original-card-request',
          }),
        ).toBe(true)
      })
      expect(prepare).not.toHaveBeenCalled()
      expect(clientMocks.get).not.toHaveBeenCalled()
      expect(clientMocks.action.mock.calls[0]?.[0].body).toMatchObject({
        action_id: 'confirm',
        base_version: 1,
        base_app_revision: 'revision-1',
        payload: { option_id: selectedId, request_id: 'original-card-request' },
      })
    },
  )
})

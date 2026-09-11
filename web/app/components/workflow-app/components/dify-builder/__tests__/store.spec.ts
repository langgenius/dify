import type { DifyBuilderRuntime } from '../store'
import type { SessionView } from '../types'
import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
} from '../session/state'
import {
  difyBuilderActiveInteractionAtom,
  difyBuilderCanComposeAtom,
  difyBuilderCanStartFixAtom,
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasLockedAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDraftAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderModelReadonlyAtom,
  difyBuilderRecheckReadyAtom,
  difyBuilderRegisterChecklistErrorsAtom,
  difyBuilderResetAtom,
  difyBuilderRunActiveAtom,
  difyBuilderRuntimeAtom,
  difyBuilderSendDraftAtom,
  difyBuilderStartChecklistFixAtom,
  difyBuilderStartPromptAtom,
  difyBuilderStartRunFixAtom,
  difyBuilderSubmitActionAtom,
} from '../store'

const builderModel = {
  completion_params: {},
  mode: 'chat',
  name: 'gpt-4o',
  provider: 'openai',
} satisfies NonNullable<SessionView['model']>

const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  app_id: 'app-1',
  canvas_read_only: false,
  conversation_last_seq: -1,
  interrupted: false,
  run_status: 'complete',
  session_id: 'session-1',
  state: 'complete',
  version: 1,
  ...overrides,
})

const createRuntime = (runAction: DifyBuilderRuntime['session']['runAction']) =>
  ({
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    onSyncDraft: vi.fn(async (): Promise<void> => undefined),
    session: {
      refresh: vi.fn(async () => true),
      getTrace: vi.fn(() => ({ entries: [], truncated: false })),
      loadOlderConversation: vi.fn(async () => true),
      restore: vi.fn(async () => true),
      reset: vi.fn(),
      runAction,
      sendMessage: vi.fn(async () => true),
      startBuild: vi.fn(async () => true),
      startChecklistFix: vi.fn(async () => true),
      startEdit: vi.fn(async () => true),
      startFix: vi.fn(async () => true),
      updateModel: vi.fn(async () => true),
    },
    setShowPanel: vi.fn(),
  }) satisfies DifyBuilderRuntime

describe('Dify Builder store', () => {
  it.each(['provide_testdata', 'start_test', 'publish'])(
    'blocks %s until the current canvas version has been applied',
    async (actionId) => {
      const store = createStore()
      const runAction = vi.fn(async () => true)
      store.set(difyBuilderRuntimeAtom, createRuntime(runAction))
      store.set(
        difyBuilderSessionViewAtom,
        createSessionView({ phase: 'test', run_status: 'waiting_input', version: 2 }),
      )
      expect(store.get(difyBuilderCanvasLockedAtom)).toBe(true)
      expect(store.get(difyBuilderCanComposeAtom)).toBe(false)
      expect(await store.set(difyBuilderSubmitActionAtom, actionId)).toBe(false)

      store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: 'session-1', version: 1 })
      expect(await store.set(difyBuilderSubmitActionAtom, actionId)).toBe(false)
      store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: 'session-1', version: 2 })
      store.set(difyBuilderCanvasRefreshFailedAtom, true)
      expect(await store.set(difyBuilderSubmitActionAtom, actionId)).toBe(false)
      expect(store.get(difyBuilderCanvasLockedAtom)).toBe(true)

      store.set(difyBuilderCanvasRefreshFailedAtom, false)
      expect(store.get(difyBuilderCanvasLockedAtom)).toBe(false)
      expect(await store.set(difyBuilderSubmitActionAtom, actionId)).toBe(true)
      expect(runAction).toHaveBeenCalledExactlyOnceWith(actionId, {})
    },
  )

  it('exposes only an interaction fenced to the current session version', () => {
    const store = createStore()
    const card = {
      at_version: 1,
      kind: 'form' as const,
      payload: { fields: [], values: {}, variant: 'testdata' as const },
      seq: 1,
    }

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        active_interaction: {
          action_id: 'provide_testdata',
          card,
          valid_at_version: 1,
        },
        version: 2,
      }),
    )
    expect(store.get(difyBuilderActiveInteractionAtom)).toBeNull()

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        active_interaction: {
          action_id: 'provide_testdata',
          card,
          valid_at_version: 2,
        },
        version: 2,
      }),
    )
    expect(store.get(difyBuilderActiveInteractionAtom)?.card).toEqual(card)
  })

  it('requires the feature, edit permission, and an idle session to start a fix', () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    store.set(difyBuilderSessionViewAtom, createSessionView())

    store.set(difyBuilderRuntimeAtom, { ...runtime, enabled: false })
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)

    store.set(difyBuilderRuntimeAtom, runtime)
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(true)

    store.set(difyBuilderRuntimeAtom, { ...runtime, canEdit: false })
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)

    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(difyBuilderSessionBusyAtom, true)
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)

    store.set(difyBuilderSessionBusyAtom, false)
    store.set(difyBuilderCanvasRefreshingAtom, true)
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)

    store.set(difyBuilderCanvasRefreshingAtom, false)
    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'processing' }))
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({ run_status: 'processing', interrupted: true }),
    )
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({ phase: 'test', run_status: 'waiting_input' }),
    )
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)
  })

  it.each(['waiting_input', 'waiting_confirmation', 'paused'] as const)(
    'starts a new Fix session while the current session is %s',
    async (runStatus) => {
      const store = createStore()
      store.set(queryClientAtom, new QueryClient())
      const runtime = createRuntime(vi.fn(async () => true))
      store.set(difyBuilderRuntimeAtom, runtime)
      store.set(
        difyBuilderSessionViewAtom,
        createSessionView({
          entry_mode: 'build',
          state: runStatus === 'waiting_input' ? 'build.goal_analysis' : 'build.plan_approval',
          run_status: runStatus,
        }),
      )
      store.set(difyBuilderDraftAtom, 'Old build conversation draft')

      expect(store.get(difyBuilderCanStartFixAtom)).toBe(true)
      expect(await store.set(difyBuilderStartRunFixAtom, 'failed-run-42')).toBe(true)
      expect(runtime.session.startFix).toHaveBeenCalledExactlyOnceWith(
        'app-1',
        'failed-run-42',
        undefined,
      )
      expect(runtime.session.sendMessage).not.toHaveBeenCalled()
      expect(store.get(difyBuilderDraftAtom)).toBe('')
    },
  )

  it('rejects a second Fix entry while the first is syncing the draft', async () => {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient())
    const runtime = createRuntime(vi.fn(async () => true))
    let finishSync!: () => void
    const sync = new Promise<void>((resolve) => {
      finishSync = resolve
    })
    runtime.onSyncDraft = vi.fn(() => sync)
    store.set(difyBuilderRuntimeAtom, runtime)

    const starting = store.set(difyBuilderStartRunFixAtom, 'failed-run-42')
    const duplicate = store.set(difyBuilderStartRunFixAtom, 'failed-run-43')
    const checklist = store.set(difyBuilderStartChecklistFixAtom, [
      {
        messages: ['Missing model'],
        node_id: 'llm-1',
        node_type: 'llm',
        plugin_missing: false,
        title: 'LLM',
        unconnected: false,
      },
    ])
    finishSync()

    expect(await starting).toBe(true)
    expect(await duplicate).toBe(false)
    expect(await checklist).toBe(false)
    expect(runtime.onSyncDraft).toHaveBeenCalledOnce()
    expect(runtime.session.startFix).toHaveBeenCalledExactlyOnceWith(
      'app-1',
      'failed-run-42',
      undefined,
    )
    expect(runtime.session.startChecklistFix).not.toHaveBeenCalled()
  })

  it('retains the existing session and draft when preparation fails, then allows retry', async () => {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient())
    const runtime = createRuntime(vi.fn(async () => true))
    const waiting = createSessionView({ run_status: 'waiting_confirmation' })
    runtime.onSyncDraft.mockRejectedValueOnce(new Error('Workflow draft sync failed.'))
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(difyBuilderSessionViewAtom, waiting)
    store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    store.set(difyBuilderDraftAtom, 'Continue the build')

    expect(await store.set(difyBuilderStartRunFixAtom, 'failed-run-42')).toBe(false)
    expect(runtime.session.startFix).not.toHaveBeenCalled()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(waiting)
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe(waiting.session_id)
    expect(store.get(difyBuilderDraftAtom)).toBe('Continue the build')
    expect(store.get(difyBuilderLocalErrorAtom)).toBe('Workflow draft sync failed.')

    expect(await store.set(difyBuilderStartRunFixAtom, 'failed-run-42')).toBe(true)
    expect(runtime.session.startFix).toHaveBeenCalledOnce()
  })

  it('makes an interrupted execution resettable without releasing its canvas lock', () => {
    const store = createStore()

    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'processing' }))
    expect(store.get(difyBuilderInteractionBusyAtom)).toBe(true)

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        canvas_read_only: true,
        interrupted: true,
        run_status: 'processing',
      }),
    )

    expect(store.get(difyBuilderInteractionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderCanvasLockedAtom)).toBe(true)
  })

  it('treats thinking as active and only enables chat at conversational gates', () => {
    const store = createStore()

    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'processing' }))
    expect(store.get(difyBuilderRunActiveAtom)).toBe(true)
    expect(store.get(difyBuilderInteractionBusyAtom)).toBe(true)
    expect(store.get(difyBuilderCanComposeAtom)).toBe(false)

    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'waiting_confirmation' }))
    expect(store.get(difyBuilderRunActiveAtom)).toBe(false)
    expect(store.get(difyBuilderCanComposeAtom)).toBe(true)
    expect(store.get(difyBuilderModelReadonlyAtom)).toBe(false)

    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'paused' }))
    expect(store.get(difyBuilderCanComposeAtom)).toBe(false)
    expect(store.get(difyBuilderModelReadonlyAtom)).toBe(true)

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        recovery: {
          can_continue: true,
          can_restart: true,
          message: 'Choose how to recover.',
          recovery_class: 'config_only',
        },
        run_status: 'waiting_confirmation',
      }),
    )
    expect(store.get(difyBuilderCanComposeAtom)).toBe(false)
    expect(store.get(difyBuilderModelReadonlyAtom)).toBe(true)

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        app_revision: { observed: 'old', current: 'new', conflicted: true },
        run_status: 'waiting_confirmation',
      }),
    )
    expect(store.get(difyBuilderCanComposeAtom)).toBe(false)
    expect(store.get(difyBuilderModelReadonlyAtom)).toBe(true)
  })

  it('does not notify fix-entry subscribers when only conversation content changes', () => {
    const store = createStore()
    store.set(difyBuilderRuntimeAtom, createRuntime(vi.fn(async () => true)))
    store.set(difyBuilderSessionViewAtom, createSessionView())
    const listener = vi.fn()
    const unsubscribe = store.sub(difyBuilderCanStartFixAtom, listener)

    store.set(difyBuilderConversationAtom, [
      {
        at_version: 2,
        kind: 'notice',
        payload: { text: 'Repair complete' },
        seq: 1,
      },
    ])

    expect(listener).not.toHaveBeenCalled()

    store.set(difyBuilderSessionBusyAtom, true)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('syncs the draft and routes active waiting-flow composer text to a multi-turn message', async () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({ run_status: 'waiting_input', state: 'fix.await_approval' }),
    )

    expect(
      await store.set(difyBuilderStartPromptAtom, {
        text: 'Make the change smaller',
        model: builderModel,
      }),
    ).toBe(true)
    expect(runtime.onSyncDraft).toHaveBeenCalledOnce()
    expect(runtime.session.sendMessage).toHaveBeenCalledWith('Make the change smaller')
  })

  it('clears the submitted draft immediately and preserves a newer draft while sending', async () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    let finishSending!: (sent: boolean) => void
    runtime.session.sendMessage = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSending = resolve
        }),
    )
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({ run_status: 'waiting_input', state: 'fix.await_approval' }),
    )
    store.set(difyBuilderDraftAtom, 'First draft')

    const sending = store.set(difyBuilderSendDraftAtom, builderModel)
    expect(store.get(difyBuilderDraftAtom)).toBe('')
    await vi.waitFor(() => {
      expect(runtime.session.sendMessage).toHaveBeenCalledWith('First draft')
    })
    store.set(difyBuilderDraftAtom, 'Newer draft')
    finishSending(true)

    expect(await sending).toBe(true)
    expect(store.get(difyBuilderDraftAtom)).toBe('Newer draft')
  })

  it('keeps the submitted draft cleared when sending fails', async () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    runtime.session.sendMessage = vi.fn(async () => false)
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({ run_status: 'waiting_input', state: 'fix.await_approval' }),
    )
    store.set(difyBuilderDraftAtom, 'Retry this message')

    expect(await store.set(difyBuilderSendDraftAtom, builderModel)).toBe(false)
    expect(store.get(difyBuilderDraftAtom)).toBe('')
  })

  it('rejects a draft without a model and preserves it for later', async () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(difyBuilderDraftAtom, 'Wait for a model')

    expect(await store.set(difyBuilderSendDraftAtom, null)).toBe(false)
    expect(store.get(difyBuilderDraftAtom)).toBe('Wait for a model')
    expect(runtime.session.startBuild).not.toHaveBeenCalled()
    expect(runtime.session.startEdit).not.toHaveBeenCalled()
    expect(runtime.session.sendMessage).not.toHaveBeenCalled()
  })

  it.each(['', 'A newer request'])(
    'restores a rejected creation prompt without replacing a newer draft: %s',
    async (newerDraft) => {
      const store = createStore()
      const runtime = createRuntime(vi.fn(async () => true))
      let finishStarting!: (started: boolean) => void
      runtime.session.startBuild = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishStarting = resolve
          }),
      )
      store.set(difyBuilderRuntimeAtom, runtime)
      store.set(difyBuilderDraftAtom, 'Build an expense assistant')

      const sending = store.set(difyBuilderSendDraftAtom, builderModel)
      await vi.waitFor(() => expect(runtime.session.startBuild).toHaveBeenCalledOnce())
      store.set(difyBuilderDraftAtom, newerDraft)
      finishStarting(false)

      expect(await sending).toBe(false)
      expect(store.get(difyBuilderDraftAtom)).toBe(newerDraft || 'Build an expense assistant')
    },
  )

  it('clears the composer draft when resetting the session', () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(difyBuilderDraftAtom, 'Discard this draft')

    store.set(difyBuilderResetAtom)

    expect(runtime.session.reset).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderDraftAtom)).toBe('')
  })

  it('does not prepare a new session while the canvas is refreshing', async () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(difyBuilderSessionViewAtom, createSessionView())
    store.set(difyBuilderCanvasRefreshingAtom, true)

    expect(
      await store.set(difyBuilderStartPromptAtom, {
        text: 'Build a support bot',
        model: builderModel,
      }),
    ).toBe(false)
    expect(runtime.onSyncDraft).not.toHaveBeenCalled()
    expect(runtime.session.startBuild).not.toHaveBeenCalled()
  })

  it('builds recheck payloads from the latest checklist atom value', async () => {
    const store = createStore()
    const runAction = vi.fn(async () => true)
    store.set(difyBuilderRuntimeAtom, createRuntime(runAction))
    const remaining = [
      {
        messages: ['Missing model'],
        node_id: 'llm-1',
        node_type: 'llm',
        plugin_missing: false,
        title: 'LLM',
        unconnected: false,
      },
    ]
    store.set(difyBuilderCanvasRefreshGenerationAtom, 1)
    store.set(difyBuilderRegisterChecklistErrorsAtom, {
      errors: remaining,
      generation: 0,
    })

    expect(store.get(difyBuilderRecheckReadyAtom)).toBe(false)
    expect(await store.set(difyBuilderSubmitActionAtom, 'recheck')).toBe(false)
    expect(runAction).not.toHaveBeenCalled()

    store.set(difyBuilderRegisterChecklistErrorsAtom, {
      errors: remaining,
      generation: 1,
    })

    await store.set(difyBuilderSubmitActionAtom, 'recheck')

    expect(runAction).toHaveBeenCalledWith('recheck', {
      passed: false,
      remaining,
    })

    store.set(difyBuilderCanvasRefreshingAtom, true)
    expect(store.get(difyBuilderRecheckReadyAtom)).toBe(false)
    expect(await store.set(difyBuilderSubmitActionAtom, 'recheck')).toBe(false)
    expect(runAction).toHaveBeenCalledOnce()
  })
})

import type { DifyBuilderRuntime } from '../store'
import type { SessionView } from '../types'
import { createStore } from 'jotai'
import { difyBuilderSessionBusyAtom, difyBuilderSessionViewAtom } from '../session/state'
import {
  difyBuilderCanStartFixAtom,
  difyBuilderCanvasLockedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDraftAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderRecheckReadyAtom,
  difyBuilderRegisterChecklistErrorsAtom,
  difyBuilderResetAtom,
  difyBuilderRuntimeAtom,
  difyBuilderSendDraftAtom,
  difyBuilderStartPromptAtom,
  difyBuilderSubmitActionAtom,
} from '../store'

const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  app_id: 'app-1',
  canvas_read_only: false,
  conversation: [],
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
    onSyncDraft: vi.fn(async () => undefined),
    session: {
      refresh: vi.fn(async () => true),
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
  it('requires the feature, edit permission, and an idle terminal session to start a fix', () => {
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
    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'executing' }))
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(false)
  })

  it('makes an interrupted execution resettable without releasing its canvas lock', () => {
    const store = createStore()

    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'executing' }))
    expect(store.get(difyBuilderInteractionBusyAtom)).toBe(true)

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        canvas_read_only: true,
        interrupted: true,
        run_status: 'executing',
      }),
    )

    expect(store.get(difyBuilderInteractionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderCanvasLockedAtom)).toBe(true)
  })

  it('does not notify fix-entry subscribers when only conversation content changes', () => {
    const store = createStore()
    store.set(difyBuilderRuntimeAtom, createRuntime(vi.fn(async () => true)))
    store.set(difyBuilderSessionViewAtom, createSessionView())
    const listener = vi.fn()
    const unsubscribe = store.sub(difyBuilderCanStartFixAtom, listener)

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        conversation: [
          {
            at_version: 2,
            kind: 'notice',
            payload: { text: 'Repair complete' },
            seq: 1,
          },
        ],
        version: 2,
      }),
    )

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

    expect(await store.set(difyBuilderStartPromptAtom, 'Make the change smaller')).toBe(true)
    expect(runtime.onSyncDraft).toHaveBeenCalledOnce()
    expect(runtime.session.sendMessage).toHaveBeenCalledWith('Make the change smaller')
  })

  it('preserves a newer draft while the submitted draft is still sending', async () => {
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

    const sending = store.set(difyBuilderSendDraftAtom)
    await vi.waitFor(() => {
      expect(runtime.session.sendMessage).toHaveBeenCalledWith('First draft')
    })
    store.set(difyBuilderDraftAtom, 'Newer draft')
    finishSending(true)

    expect(await sending).toBe(true)
    expect(store.get(difyBuilderDraftAtom)).toBe('Newer draft')
  })

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

    expect(await store.set(difyBuilderStartPromptAtom, 'Build a support bot')).toBe(false)
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

import type { DifyBuilderRuntime } from '../store'
import type { SessionView } from '@/app/components/dify-builder/contract/types'
import { createStore } from 'jotai'
import {
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
} from '@/app/components/dify-builder/state'
import {
  difyBuilderCanStartFixAtom,
  difyBuilderChecklistErrorsAtom,
  difyBuilderRuntimeAtom,
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
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    onSyncDraft: vi.fn(async () => undefined),
    session: {
      refresh: vi.fn(async () => true),
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
    store.set(difyBuilderChecklistErrorsAtom, remaining)

    await store.set(difyBuilderSubmitActionAtom, 'recheck')

    expect(runAction).toHaveBeenCalledWith('recheck', {
      passed: false,
      remaining,
    })
  })
})

import type { InteractionResponseCopy } from '../interactions/optimistic-response'
import type { DifyBuilderRuntime } from '../state'
import type { SessionView } from '../types'
import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import {
  difyBuilderConversationAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderMaterialControlAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
} from '../session/state'
import {
  difyBuilderActiveInteractionAtom,
  difyBuilderCanComposeAtom,
  difyBuilderCanStartFixAtom,
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderCheckMaterialAtom,
  difyBuilderDraftAtom,
  difyBuilderModelReadonlyAtom,
  difyBuilderResetAtom,
  difyBuilderRuntimeAtom,
  difyBuilderSendDraftAtom,
  difyBuilderStartChecklistFixAtom,
  difyBuilderStartPromptAtom,
  difyBuilderStartRunFixAtom,
  difyBuilderSubmitActionAtom,
} from '../state'

const builderModel = {
  completion_params: {},
  mode: 'chat',
  name: 'gpt-4o',
  provider: 'openai',
} satisfies NonNullable<SessionView['model']>

const englishResponseCopy: InteractionResponseCopy = {
  renderText: (text) => (typeof text === 'string' ? text : ''),
  replyLanguage: 'en-US',
  booleanFalse: 'No',
  booleanTrue: 'Yes',
  noResourcesSelected: 'No resources selected',
}
const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  canvas_read_only: false,
  conversation_last_seq: -1,
  interrupted: false,
  phase: 'understand',
  run_status: 'complete',
  reply_language: '',
  session_id: 'session-1',
  version: 1,
  ...overrides,
})

const createRuntime = (runAction: DifyBuilderRuntime['session']['runAction']) =>
  ({
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edges: [], isChatflow: false }),
    retryCanvasRefresh: vi.fn(),
    session: {
      onCanvasRefreshed: vi.fn(),
      refresh: vi.fn(async () => true),
      getTrace: vi.fn(() => ({ entries: [], truncated: false })),
      loadOlderConversation: vi.fn(async () => true),
      restore: vi.fn(async () => true),
      stopTask: vi.fn(async () => true),
      resumeTask: vi.fn(async () => true),
      reset: vi.fn(),
      clearConversation: vi.fn(async () => true),
      abandonTask: vi.fn(async () => true),
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
      expect(store.get(difyBuilderCanComposeAtom)).toBe(false)
      expect(await store.set(difyBuilderSubmitActionAtom, actionId, {}, englishResponseCopy)).toBe(
        false,
      )

      store.set(difyBuilderCanvasAppliedViewAtom, {
        sessionId: 'session-1',
        version: 1,
      })
      expect(await store.set(difyBuilderSubmitActionAtom, actionId, {}, englishResponseCopy)).toBe(
        false,
      )
      store.set(difyBuilderCanvasAppliedViewAtom, {
        sessionId: 'session-1',
        version: 2,
      })
      store.set(difyBuilderCanvasRefreshFailedAtom, true)
      expect(await store.set(difyBuilderSubmitActionAtom, actionId, {}, englishResponseCopy)).toBe(
        false,
      )

      store.set(difyBuilderCanvasRefreshFailedAtom, false)
      expect(await store.set(difyBuilderSubmitActionAtom, actionId, {}, englishResponseCopy)).toBe(
        true,
      )
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
    store.set(difyBuilderConversationAtom, [card])

    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        active_interaction: {
          action_id: 'provide_testdata',
          card_seq: card.seq,
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
          card_seq: card.seq,
          valid_at_version: 2,
        },
        version: 2,
      }),
    )
    expect(store.get(difyBuilderActiveInteractionAtom)?.card).toEqual(card)
  })

  it('requires the feature and edit permission but allows Fix intake during an existing task', () => {
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
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(true)

    store.set(difyBuilderSessionBusyAtom, false)
    store.set(difyBuilderCanvasRefreshingAtom, true)
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(true)

    store.set(difyBuilderCanvasRefreshingAtom, false)
    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'processing' }))
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(true)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({ run_status: 'processing', interrupted: true }),
    )
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(true)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({ phase: 'test', run_status: 'waiting_input' }),
    )
    expect(store.get(difyBuilderCanStartFixAtom)).toBe(true)
  })

  it('rejects a second Fix entry while the first command is preparing', async () => {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient())
    const runtime = createRuntime(vi.fn(async () => true))
    let finishSync!: (started: boolean) => void
    const sync = new Promise<boolean>((resolve) => {
      finishSync = resolve
    })
    runtime.session.startFix = vi.fn(() => sync)
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
    finishSync(true)

    expect(await starting).toBe(true)
    expect(await duplicate).toBe(false)
    expect(await checklist).toBe(false)
    expect(runtime.session.startFix).toHaveBeenCalledExactlyOnceWith(
      'app-1',
      'failed-run-42',
      undefined,
    )
    expect(runtime.session.startChecklistFix).not.toHaveBeenCalled()
  })

  it('keeps the submitted draft cleared when sending fails', async () => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    runtime.session.sendMessage = vi.fn(async () => false)
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'waiting_input' }))
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
      expect(store.get(difyBuilderLocalUserMessageAtom)).toBeNull()
    },
  )

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
    expect(runtime.session.startBuild).not.toHaveBeenCalled()
  })
})

it.each([
  {
    scenario: 'running task',
    view: createSessionView({ run_status: 'processing' }),
    busy: false,
  },
  {
    scenario: 'pending command',
    view: createSessionView({ run_status: 'waiting_input' }),
    busy: true,
  },
])(
  'rejects attachment submission during a $scenario and preserves the draft',
  async ({ view, busy }) => {
    const store = createStore()
    const runtime = createRuntime(vi.fn(async () => true))
    store.set(difyBuilderRuntimeAtom, runtime)
    store.set(difyBuilderSessionViewAtom, view)
    store.set(difyBuilderSessionBusyAtom, busy)
    store.set(difyBuilderDraftAtom, 'Material context')

    expect(
      await store.set(difyBuilderSendDraftAtom, builderModel, {
        attachments: [{ upload_file_id: 'upload-1' }],
      }),
    ).toBe(false)
    expect(store.get(difyBuilderDraftAtom)).toBe('Material context')
    expect(runtime.session.sendMessage).not.toHaveBeenCalled()
  },
)

it('sends at most five uploaded material refs when input is available, restores failed drafts, and checks unknown without resending', async () => {
  const store = createStore()
  const runtime = createRuntime(vi.fn(async () => true))
  store.set(difyBuilderRuntimeAtom, runtime)
  store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'waiting_input' }))
  store.set(difyBuilderDraftAtom, 'Material context')
  const attachments = [{ upload_file_id: 'upload-1' }]
  runtime.session.sendMessage.mockResolvedValueOnce(false)
  expect(await store.set(difyBuilderSendDraftAtom, builderModel, { attachments })).toBe(false)
  expect(store.get(difyBuilderDraftAtom)).toBe('Material context')
  expect(runtime.session.sendMessage).toHaveBeenCalledExactlyOnceWith(
    'Material context',
    undefined,
    attachments,
  )
  expect(runtime.session.startBuild).not.toHaveBeenCalled()
  expect(
    await store.set(difyBuilderSendDraftAtom, builderModel, {
      attachments: Array.from({ length: 6 }, (_, index) => ({ upload_file_id: `upload-${index}` })),
    }),
  ).toBe(false)
  expect(runtime.session.sendMessage).toHaveBeenCalledOnce()
  store.set(difyBuilderMaterialControlAtom, {
    phase: 'unknown',
    clientTurnId: 'material-turn',
    text: 'Material context',
    attachments,
  })
  expect(await store.set(difyBuilderSendDraftAtom, builderModel, { attachments })).toBe(false)
  store.set(difyBuilderSessionBusyAtom, false)
  expect(await store.set(difyBuilderCheckMaterialAtom)).toBe(true)
  expect(runtime.session.refresh).toHaveBeenCalledOnce()
  expect(runtime.session.sendMessage).toHaveBeenCalledOnce()
})

it('creates a file-only Build with uploaded refs and restores its text on rejection', async () => {
  const store = createStore()
  const runtime = createRuntime(vi.fn(async () => true))
  store.set(difyBuilderRuntimeAtom, runtime)
  const attachments = [{ upload_file_id: 'upload-1' }]
  expect(await store.set(difyBuilderSendDraftAtom, builderModel, { attachments })).toBe(true)
  expect(runtime.session.startBuild).toHaveBeenCalledExactlyOnceWith(
    'app-1',
    '',
    builderModel,
    false,
    attachments,
  )
  runtime.session.startBuild.mockResolvedValueOnce(false)
  store.set(difyBuilderDraftAtom, 'Use the rules')
  expect(await store.set(difyBuilderSendDraftAtom, builderModel, { attachments })).toBe(false)
  expect(store.get(difyBuilderDraftAtom)).toBe('Use the rules')
})

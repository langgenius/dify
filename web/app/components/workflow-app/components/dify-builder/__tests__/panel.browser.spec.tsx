import type { ConversationItem, SessionView } from '../types'
import { createStore, Provider } from 'jotai'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DifyBuilderPanel from '../panel'
import { difyBuilderConversationAtom, difyBuilderSessionViewAtom } from '../session/state'
import { difyBuilderRuntimeAtom } from '../store'

const mocks = vi.hoisted(() => ({
  closePanel: vi.fn(),
}))

const sessionView: SessionView = {
  actions: [{ id: 'approve_plan', label: 'Approve plan', kind: 'primary' }],
  app_revision: { observed: 'hash-1', current: 'hash-1', conflicted: false },
  app_id: 'app-1',
  canvas_read_only: false,
  active_interaction: null,
  conversation_last_seq: 19,
  entry_mode: 'fix',
  interrupted: false,
  phase: 'plan',
  run_status: 'waiting_input',
  session_id: 'session-1',
  state: 'fix.await_approval',
  version: 1,
}

const conversation = Array.from({ length: 20 }, (_, index): ConversationItem => ({
  seq: index,
  at_version: 1,
  kind: 'notice',
  payload: { text: `Conversation message ${index + 1}` },
}))

vi.mock('../model-selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))

vi.mock('../use-dify-builder-model', () => ({
  useDifyBuilderModel: () => ({
    model: {
      completion_params: {},
      mode: 'chat',
      name: 'gpt-4o',
      provider: 'openai',
    },
    modelList: [],
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { setShowDifyBuilderPanel: typeof mocks.closePanel }) => T) =>
    selector({ setShowDifyBuilderPanel: mocks.closePanel }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: <T,>(selector: (state: { configsMap?: undefined }) => T) =>
    selector({ configsMap: undefined }),
}))

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

describe('DifyBuilderPanel layout', () => {
  // Scrolling and rendered geometry are owned by Chromium and cannot be represented by happy-dom.
  it('scrolls conversation actions with the messages while keeping the composer fixed', async () => {
    await page.viewport(1280, 720)
    const store = createStore()
    store.set(difyBuilderSessionViewAtom, sessionView)
    store.set(difyBuilderConversationAtom, conversation)
    store.set(difyBuilderRuntimeAtom, {
      appId: 'app-1',
      canEdit: true,
      enabled: true,
      getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
      onSyncDraft: vi.fn(async () => undefined),
      session: {
        refresh: vi.fn(async () => true),
        getTrace: vi.fn(() => ({ entries: [], truncated: false })),
        loadOlderConversation: vi.fn(async () => true),
        restore: vi.fn(async () => true),
        reset: vi.fn(),
        runAction: vi.fn(async () => true),
        sendMessage: vi.fn(async () => true),
        startBuild: vi.fn(async () => true),
        startChecklistFix: vi.fn(async () => true),
        startEdit: vi.fn(async () => true),
        startFix: vi.fn(async () => true),
        updateModel: vi.fn(async () => true),
      },
      setShowPanel: mocks.closePanel,
    })

    const screen = await render(
      <div style={{ height: 360, width: 400 }}>
        <Provider store={store}>
          <DifyBuilderPanel />
        </Provider>
      </div>,
    )
    const panel = screen
      .getByRole('complementary', { name: 'workflow.difyBuilder.panelTitle' })
      .element()
    const action = screen.getByRole('button', { name: 'Approve plan' }).element()
    const composer = screen
      .getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' })
      .element()
    const scrollContainer = Array.from(panel.querySelectorAll<HTMLElement>('*')).find((element) => {
      const overflowY = getComputedStyle(element).overflowY
      return ['auto', 'scroll'].includes(overflowY) && element.scrollHeight > element.clientHeight
    })
    if (!scrollContainer) throw new Error('Conversation scroll container was not rendered')

    scrollContainer.scrollTop = scrollContainer.scrollHeight
    scrollContainer.dispatchEvent(new Event('scroll'))
    await nextFrame()

    const scrollRectAtBottom = scrollContainer.getBoundingClientRect()
    const actionRectAtBottom = action.getBoundingClientRect()
    expect(actionRectAtBottom.top).toBeGreaterThanOrEqual(scrollRectAtBottom.top)
    expect(actionRectAtBottom.bottom).toBeLessThanOrEqual(scrollRectAtBottom.bottom)
    const composerTop = composer.getBoundingClientRect().top

    scrollContainer.scrollTop = 0
    scrollContainer.dispatchEvent(new Event('scroll'))
    await nextFrame()

    expect(action.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      scrollContainer.getBoundingClientRect().bottom,
    )
    expect(composer.getBoundingClientRect().top).toBe(composerTop)
  })
})

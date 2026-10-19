import type { SessionView } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DifyBuilderPanel from '../panel'
import { difyBuilderSessionViewAtom } from '../session/state'
import { difyBuilderRuntimeAtom } from '../store'

// Conversation rendering and the disabled composer have independent owner tests.
// Keep the production panel, header, interaction, and animation real.
vi.mock('../conversation', () => ({ DifyBuilderConversation: () => null }))
vi.mock('../composer', () => ({
  default: () => <textarea aria-label="Message" disabled />,
}))
vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { setShowDifyBuilderPanel: (show: boolean) => void }) => T) =>
    selector({ setShowDifyBuilderPanel: vi.fn() }),
}))

it('moves focus before making a submitted interaction inert and preserves its animated lifetime', async () => {
  // Chromium's inert focus eviction and native Tab order expose an attribute update
  // that runs before focus transfer; the unit DOM does not implement that eviction.
  const store = createStore()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  store.set(queryClientAtom, queryClient)
  const view: SessionView = {
    actions: [{ id: 'approve_plan', label: 'Approve plan', kind: 'primary' }],
    active_interaction: null,
    app_revision: { current: 'hash-1', conflicted: false },
    canvas_read_only: false,
    conversation_last_seq: 0,
    decision: {
      title: 'Is this workflow plan ready to apply?',
      description: 'Choose one option to continue.',
      default_option_id: 'approve_plan',
      options: [{ id: 'approve_plan', label: 'Approve plan', is_default: true }],
      submit: { id: 'confirm', label: 'Submit', kind: 'primary' },
    },
    interrupted: false,
    phase: 'plan',
    reply_language: '',
    run_status: 'waiting_confirmation',
    session_id: 'session-1',
    version: 1,
  }
  store.set(difyBuilderSessionViewAtom, view)
  let finishAction!: (submitted: boolean) => void
  const action = new Promise<boolean>((resolve) => {
    finishAction = resolve
  })
  store.set(difyBuilderRuntimeAtom, {
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edges: [], isChatflow: false }),
    session: {
      getTrace: () => ({ entries: [], truncated: false }),
      loadOlderConversation: async () => true,
      onCanvasRefreshed: vi.fn(),
      refresh: async () => true,
      reset: vi.fn(),
      restore: async () => true,
      runAction: () => action,
      sendMessage: async () => true,
      startBuild: async () => true,
      startChecklistFix: async () => true,
      startEdit: async () => true,
      startFix: async () => true,
      updateModel: async () => true,
    },
    setShowPanel: vi.fn(),
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <div className="h-160 w-100">
          <DifyBuilderPanel />
          <button type="button">After builder</button>
        </div>
      </Provider>
    </QueryClientProvider>,
  )
  const submit = screen.getByRole('button', { name: 'Submit' })
  await expect.element(submit).toBeVisible()
  const submitElement = submit.element()

  try {
    await submit.click()

    const title = screen.getByRole('heading', {
      level: 2,
      name: 'difyBuilder.panelTitle',
    })
    await expect.element(title).toHaveFocus()
    await expect.poll(() => submitElement.checkVisibility({ checkOpacity: true })).toBe(false)
    expect(submitElement.isConnected).toBe(true)
    await expect.element(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()

    await userEvent.tab()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.more' }))
      .toHaveFocus()
    await userEvent.tab()
    await expect
      .element(screen.getByRole('button', { name: 'difyBuilder.helpTitle' }))
      .toHaveFocus()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'difyBuilder.reset' })).toHaveFocus()
    await userEvent.tab()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.close' }))
      .toHaveFocus()
    await userEvent.tab()
    const after = screen.getByRole('button', { name: 'After builder' })
    await expect.element(after).toHaveFocus()
    submitElement.focus()
    await expect.element(after).toHaveFocus()

    finishAction(false)
    await expect.element(submit).toBeVisible()
    await expect.poll(() => submitElement.checkVisibility({ checkOpacity: true })).toBe(true)
    await userEvent.tab({ shift: true })
    await expect.element(submit).toHaveFocus()
  } finally {
    finishAction(false)
    await action
    queryClient.clear()
  }
})

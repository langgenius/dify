import type { AgentSoulAppFeaturesConfig } from '@dify/contracts/api/console/agent/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { agentComposerAppFeaturesAtom } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { AgentChatFeaturesPanel } from '../chat-features-panel'

vi.mock('@/context/hooks/use-trigger-events-limit-modal', () => ({
  useTriggerEventsLimitModal: () => ({ triggerEventsLimitModal: null }),
}))

function PanelHarness({
  snapshot,
  disabled = false,
}: {
  snapshot: AgentSoulAppFeaturesConfig
  disabled?: boolean
}) {
  const [show, setShow] = useState(true)
  return (
    <>
      <button onClick={() => setShow(true)}>Open features</button>
      <AgentChatFeaturesPanel
        appFeatures={snapshot}
        disabled={disabled}
        show={show}
        onClose={() => setShow(false)}
      />
    </>
  )
}

function renderPanel(snapshot: AgentSoulAppFeaturesConfig, draft = snapshot, disabled = false) {
  const store = createStore()
  store.set(agentComposerAppFeaturesAtom, draft)
  const ui = (currentSnapshot: AgentSoulAppFeaturesConfig) => (
    <Provider store={store}>
      <NuqsTestingAdapter>
        <ModalContextProvider>
          <PanelHarness snapshot={currentSnapshot} disabled={disabled} />
        </ModalContextProvider>
      </NuqsTestingAdapter>
    </Provider>
  )
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  const rendered = renderWithConsoleQuery(ui(snapshot), { queryClient })
  return {
    ...rendered,
    store,
    updateSnapshot: (next: AgentSoulAppFeaturesConfig) => rendered.rerender(ui(next)),
  }
}

describe('AgentChatFeaturesPanel', () => {
  it('keeps a newly saved opener enabled before the server snapshot catches up', async () => {
    const user = userEvent.setup({ skipHover: true })
    const { updateSnapshot, store } = renderPanel({ opening_statement: '' })

    await user.click(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    )
    await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
    await user.click(screen.getByRole('button', { name: 'appDebug.openingStatement.writeOpener' }))
    const editor = await screen.findByRole('textbox')
    await user.click(editor)
    await user.paste('Hello from the unsaved draft')
    updateSnapshot({ opening_statement: '', suggested_questions: [] })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(await screen.findByText('Hello from the unsaved draft')).toBeVisible()
    expect(store.get(agentComposerAppFeaturesAtom)?.opening_statement).toBe(
      'Hello from the unsaved draft',
    )
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('switch')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Open features' }))
    expect(await screen.findByText('Hello from the unsaved draft')).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()
  })

  it('initializes editable features from the current draft instead of the stale snapshot', () => {
    renderPanel({ opening_statement: '' }, { opening_statement: 'Current draft opener' })
    expect(screen.getByText('Current draft opener')).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()
  })

  it('shows the selected snapshot without changing the editable draft in read-only mode', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel(
      { opening_statement: 'Published opener' },
      { opening_statement: 'Current draft opener' },
      true,
    )
    expect(screen.getByText('Published opener')).toBeVisible()
    expect(screen.queryByText('Current draft opener')).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()
    const opener = screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' })
    expect(opener).toHaveAttribute('aria-disabled', 'true')
    await user.click(opener)
    expect(store.get(agentComposerAppFeaturesAtom)?.opening_statement).toBe('Current draft opener')
  })
})

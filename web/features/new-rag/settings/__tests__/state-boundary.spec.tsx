import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import { render } from '@/test/console/render'
import { KnowledgeSettingsStateBoundary } from '../state/boundary'
import { knowledgeSettingsSpaceIdAtom } from '../state/inputs'
import {
  knowledgeSettingsHasUnsavedWorkAtom,
  startKnowledgeSettingsBasicDraftAtom,
} from '../state/workflow'

const globalProbeAtom = atom('global-before')

function WorkflowProbe({ name }: { name: string }) {
  const globalValue = useAtomValue(globalProbeAtom)
  const hasUnsavedWork = useAtomValue(knowledgeSettingsHasUnsavedWorkAtom)
  const knowledgeSpaceId = useAtomValue(knowledgeSettingsSpaceIdAtom)
  const startDraft = useSetAtom(startKnowledgeSettingsBasicDraftAtom)

  return (
    <section aria-label={name}>
      <span>{globalValue}</span>
      <span>{hasUnsavedWork ? 'dirty' : 'clean'}</span>
      <span>{knowledgeSpaceId}</span>
      <button onClick={startDraft} type="button">
        start draft
      </button>
    </section>
  )
}

function GlobalProbeControl() {
  const setGlobalValue = useSetAtom(globalProbeAtom)

  return (
    <button onClick={() => setGlobalValue('global-after')} type="button">
      update global
    </button>
  )
}

describe('KnowledgeSettingsStateBoundary', () => {
  it('keeps parent atoms visible while isolating workflow state between instances', async () => {
    const user = userEvent.setup()
    const store = createStore()

    render(
      <Provider store={store}>
        <GlobalProbeControl />
        <KnowledgeSettingsStateBoundary knowledgeSpaceId="space-1">
          <WorkflowProbe name="first settings instance" />
        </KnowledgeSettingsStateBoundary>
        <KnowledgeSettingsStateBoundary knowledgeSpaceId="space-1">
          <WorkflowProbe name="second settings instance" />
        </KnowledgeSettingsStateBoundary>
      </Provider>,
    )

    const first = within(screen.getByRole('region', { name: 'first settings instance' }))
    const second = within(screen.getByRole('region', { name: 'second settings instance' }))

    await user.click(first.getByRole('button', { name: 'start draft' }))
    expect(first.getByText('dirty')).toBeInTheDocument()
    expect(second.getByText('clean')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'update global' }))
    expect(first.getByText('global-after')).toBeInTheDocument()
    expect(second.getByText('global-after')).toBeInTheDocument()
  })

  it('resets scoped workflow state when the route identity changes', async () => {
    const user = userEvent.setup()
    const store = createStore()
    const tree = (knowledgeSpaceId: string) => (
      <Provider store={store}>
        <KnowledgeSettingsStateBoundary knowledgeSpaceId={knowledgeSpaceId}>
          <WorkflowProbe name="settings instance" />
        </KnowledgeSettingsStateBoundary>
      </Provider>
    )
    const rendered = render(tree('space-1'))
    const instance = within(screen.getByRole('region', { name: 'settings instance' }))

    await user.click(instance.getByRole('button', { name: 'start draft' }))
    expect(instance.getByText('dirty')).toBeInTheDocument()

    rendered.rerender(tree('space-2'))

    const resetInstance = within(screen.getByRole('region', { name: 'settings instance' }))
    expect(resetInstance.getByText('clean')).toBeInTheDocument()
    expect(resetInstance.getByText('space-2')).toBeInTheDocument()
  })
})

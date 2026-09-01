import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import { render } from '@/test/console/render'
import { KnowledgeSettingsStateBoundary } from '../state/boundary'
import { knowledgeSettingsSpaceIdAtom } from '../state/inputs'
import {
  knowledgeSettingsHasPendingSaveAtom,
  setKnowledgeSettingsSavePendingAtom,
} from '../state/workflow'

const globalProbeAtom = atom('global-before')

function WorkflowProbe({ name }: { name: string }) {
  const globalValue = useAtomValue(globalProbeAtom)
  const hasPendingSave = useAtomValue(knowledgeSettingsHasPendingSaveAtom)
  const knowledgeSpaceId = useAtomValue(knowledgeSettingsSpaceIdAtom)
  const setSavePending = useSetAtom(setKnowledgeSettingsSavePendingAtom)

  return (
    <section aria-label={name}>
      <span>{globalValue}</span>
      <span>{hasPendingSave ? 'saving' : 'idle'}</span>
      <span>{knowledgeSpaceId}</span>
      <button onClick={() => setSavePending({ owner: 'probe', pending: true })} type="button">
        start saving
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

    await user.click(first.getByRole('button', { name: 'start saving' }))
    expect(first.getByText('saving')).toBeInTheDocument()
    expect(second.getByText('idle')).toBeInTheDocument()

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

    await user.click(instance.getByRole('button', { name: 'start saving' }))
    expect(instance.getByText('saving')).toBeInTheDocument()

    rendered.rerender(tree('space-2'))

    const resetInstance = within(screen.getByRole('region', { name: 'settings instance' }))
    expect(resetInstance.getByText('idle')).toBeInTheDocument()
    expect(resetInstance.getByText('space-2')).toBeInTheDocument()
  })
})

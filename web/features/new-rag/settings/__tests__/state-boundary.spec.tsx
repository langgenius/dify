import type { KnowledgeSettingsSnapshot } from '../draft'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import { render } from '@/test/console/render'
import { settingsDraftFromSnapshot } from '../draft'
import { KnowledgeSettingsStateBoundary } from '../state/boundary'
import { knowledgeSettingsEditSessionAtom } from '../state/draft'
import { knowledgeSettingsSpaceIdAtom } from '../state/inputs'
import {
  knowledgeSettingsHasPendingSaveAtom,
  setKnowledgeSettingsSavePendingAtom,
} from '../state/workflow'

const globalProbeAtom = atom('global-before')

const savedSnapshot: KnowledgeSettingsSnapshot = {
  space: {
    control_space_id: 'space-1',
    created_at: '2026-07-28T00:00:00Z',
    knowledge_space_id: 'knowledge-1',
    owner_account_id: 'owner-1',
    permission_keys: ['knowledge_space_edit', 'knowledge_space_read'],
    resource_version: 1,
    state: 'active',
    technical_status: 'available',
    technical_summary: {
      description: '',
      document_count: 0,
      knowledge_space_id: 'knowledge-1',
      name: 'Saved title',
      revision: 1,
      slug: 'saved-title',
    },
    updated_at: '2026-07-28T00:00:00Z',
    visibility: 'only_me',
  },
  permissions: [],
  settings: {
    active_profile_available: false,
    active_profile_revisions: {},
    capabilities: {
      deep: false,
      index: false,
      ingest: false,
      query: false,
      research: false,
      source_sync: false,
    },
    configuration_state: 'setup-required',
    embedding: null,
    retrieval: null,
    issues: [],
    revision: 1,
  },
}

function WorkflowProbe({ name }: { name: string }) {
  const globalValue = useAtomValue(globalProbeAtom)
  const hasPendingSave = useAtomValue(knowledgeSettingsHasPendingSaveAtom)
  const knowledgeSpaceId = useAtomValue(knowledgeSettingsSpaceIdAtom)
  const setSavePending = useSetAtom(setKnowledgeSettingsSavePendingAtom)
  const editSession = useAtomValue(knowledgeSettingsEditSessionAtom)
  const setEditSession = useSetAtom(knowledgeSettingsEditSessionAtom)

  return (
    <section aria-label={name}>
      <span>{globalValue}</span>
      <span>{hasPendingSave ? 'saving' : 'idle'}</span>
      <span>{knowledgeSpaceId}</span>
      <label>
        Draft name
        <input
          value={editSession?.draft.basic.name ?? 'Saved title'}
          onChange={(event) => {
            const baseline = editSession?.baseline ?? savedSnapshot
            const draft = editSession?.draft ?? settingsDraftFromSnapshot(baseline)
            setEditSession({
              baseline,
              draft: { ...draft, basic: { ...draft.basic, name: event.target.value } },
            })
          }}
        />
      </label>
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

    await user.clear(first.getByRole('textbox', { name: 'Draft name' }))
    await user.type(first.getByRole('textbox', { name: 'Draft name' }), 'Local edit')
    expect(first.getByRole('textbox', { name: 'Draft name' })).toHaveValue('Local edit')
    expect(second.getByRole('textbox', { name: 'Draft name' })).toHaveValue('Saved title')

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

    await user.type(instance.getByRole('textbox', { name: 'Draft name' }), ' unsaved')
    await user.click(instance.getByRole('button', { name: 'start saving' }))
    expect(instance.getByText('saving')).toBeInTheDocument()

    rendered.rerender(tree('space-2'))

    const resetInstance = within(screen.getByRole('region', { name: 'settings instance' }))
    expect(resetInstance.getByText('idle')).toBeInTheDocument()
    expect(resetInstance.getByText('space-2')).toBeInTheDocument()
    expect(resetInstance.getByRole('textbox', { name: 'Draft name' })).toHaveValue('Saved title')
  })
  it('keeps route identities and edits independent for two different spaces in the same parent store', async () => {
    const user = userEvent.setup()
    render(
      <Provider store={createStore()}>
        <KnowledgeSettingsStateBoundary knowledgeSpaceId="space-1">
          <WorkflowProbe name="first space" />
        </KnowledgeSettingsStateBoundary>
        <KnowledgeSettingsStateBoundary knowledgeSpaceId="space-2">
          <WorkflowProbe name="second space" />
        </KnowledgeSettingsStateBoundary>
      </Provider>,
    )
    const first = within(screen.getByRole('region', { name: 'first space' }))
    const second = within(screen.getByRole('region', { name: 'second space' }))
    expect(first.getByText('space-1')).toBeInTheDocument()
    expect(second.getByText('space-2')).toBeInTheDocument()
    await user.type(second.getByRole('textbox', { name: 'Draft name' }), ' for second space')
    await user.click(second.getByRole('button', { name: 'start saving' }))
    expect(first.getByRole('textbox', { name: 'Draft name' })).toHaveValue('Saved title')
    expect(first.getByText('idle')).toBeInTheDocument()
    expect(second.getByRole('textbox', { name: 'Draft name' })).toHaveValue(
      'Saved title for second space',
    )
    expect(second.getByText('saving')).toBeInTheDocument()
  })
})

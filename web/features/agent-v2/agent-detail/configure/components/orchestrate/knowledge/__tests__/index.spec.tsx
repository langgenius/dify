import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { zKnowledgeFsSpaceListResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { describe, expect, it } from 'vite-plus/test'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import {
  AgentOrchestrateReadOnlyContext,
  AgentOrchestrateViewingVersionContext,
} from '../../read-only-context'
import { AgentKnowledgeRetrieval } from '../index'

const SPACE = '00000000-0000-4000-8000-000000000001'
const SECOND = '00000000-0000-4000-8000-000000000002'
const space = (
  id = SPACE,
  name = 'Product manual',
  available = true,
): KnowledgeFsSpaceListItemResponse => ({
  control_space_id: id,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account',
  permission_keys: ['knowledge_space_read', 'knowledge_space_query'],
  resource_version: 1,
  state: 'active',
  technical_status: available ? 'available' : 'unavailable',
  visibility: 'only_me',
  technical_summary: {
    knowledge_space_id: id,
    name,
    description: 'A real knowledge space',
    revision: 1,
    slug: id,
  },
})
const binding = { id: 'docs', controlSpaceId: SPACE, name: 'Product manual' }

function Snapshot({ label = 'snapshot' }: { label?: string }) {
  const draft = useAtomValue(agentComposerDraftAtom)
  return (
    <output aria-label={label}>
      {JSON.stringify({
        prompt: draft.prompt,
        knowledge: formStateToAgentSoulConfig({ formState: draft }).knowledge,
      })}
    </output>
  )
}

function setup(
  bindings: AgentKnowledgeRetrievalItem[] = [],
  {
    enabled = true,
    viewingVersion = false,
    readOnly = false,
    label = 'snapshot',
    spaces = [space(), space(SECOND, 'Engineering')],
  } = {},
) {
  const queryClient = createConsoleQueryClient()
  const options = consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
    input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: () => undefined,
  })
  queryClient.setQueryData(options.queryKey, {
    pages: [
      zKnowledgeFsSpaceListResponse.parse({ data: spaces, page: 1, limit: 50, has_more: false }),
    ],
    pageParams: [1],
  })
  return render(
    <AgentComposerProvider
      initialDraft={{
        ...defaultAgentSoulConfigFormState,
        prompt: '[§knowledge:docs:Product manual§]',
        knowledgeRetrievals: bindings,
      }}
    >
      <AgentOrchestrateViewingVersionContext value={viewingVersion}>
        <AgentOrchestrateReadOnlyContext value={readOnly}>
          <AgentKnowledgeRetrieval />
        </AgentOrchestrateReadOnlyContext>
      </AgentOrchestrateViewingVersionContext>
      <Snapshot label={label} />
    </AgentComposerProvider>,
    { queryClient, systemFeatures: { agent_knowledge_fs_enabled: enabled } },
  )
}
const snapshot = () => JSON.parse(screen.getByLabelText('snapshot').textContent ?? '{}')
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /knowledgeFs.add/ }))
  return screen.findByRole('dialog')
}

describe('KnowledgeFS composer interaction', () => {
  it('selects multiple real names and commits only on confirmation', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Product manual' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Engineering' }))
    expect(snapshot().knowledge.spaces).toEqual([])
    expect(within(dialog).queryByText(/retrievalSetting/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces.map((item: { name: string }) => item.name)).toEqual([
      'Product manual',
      'Engineering',
    ])
    expect(snapshot().knowledge.sets).toEqual([])
  })

  it('discards cancelled edits and resets the next dialog draft', async () => {
    const user = userEvent.setup()
    setup([binding])
    let dialog = await open(user)
    const alias = within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })
    await user.clear(alias)
    await user.type(alias, 'Unsaved')
    await user.click(within(dialog).getByRole('button', { name: /operation.cancel/ }))
    expect(snapshot().knowledge.spaces[0].name).toBe('Product manual')
    dialog = await open(user)
    expect(within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })).toHaveValue(
      'Product manual',
    )
  })

  it('renames a stable binding and its prompt reference, then removes it', async () => {
    const user = userEvent.setup()
    setup([binding])
    const dialog = await open(user)
    const alias = within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })
    await user.clear(alias)
    await user.type(alias, 'Support docs')
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces[0]).toMatchObject({ id: 'docs', name: 'Support docs' })
    expect(snapshot().prompt).toContain('Support docs')
    await user.click(screen.getByRole('button', { name: /knowledgeRetrieval.remove/ }))
    expect(snapshot().knowledge.spaces).toEqual([])
  })

  it('requires explicit rebind after import and explicit removal of legacy datasets', async () => {
    const user = userEvent.setup()
    setup([{ ...binding, isMissing: true }])
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(snapshot().knowledge.spaces[0].is_missing).toBe(true)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Product manual' }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces[0].is_missing).toBe(false)
  })

  it('does not allow unavailable spaces and explains missing publish permission', async () => {
    const user = userEvent.setup()
    setup([binding], { spaces: [space(), space(SECOND, 'Unavailable', false)] })
    const dialog = await open(user)
    const unavailable = within(dialog).getByRole('checkbox', { name: 'Unavailable' })
    expect(unavailable).toHaveAttribute('aria-disabled', 'true')
    await user.click(unavailable)
    expect(unavailable).toHaveAttribute('aria-checked', 'false')
    expect(within(dialog).getByText(/knowledgeFs.publishPermission/)).toBeInTheDocument()
  })

  it('shows a migration warning without silently discarding historical config', async () => {
    const user = userEvent.setup()
    setup([{ id: 'legacy', name: 'Old documents', datasetRefs: [{ id: 'dataset' }] }])
    const dialog = await open(user)
    expect(within(dialog).getByText(/knowledgeFs.legacy/)).toBeInTheDocument()
    expect(snapshot().knowledge.sets).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: /knowledgeFs.removeLegacy/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Product manual' }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets).toEqual([])
    expect(snapshot().knowledge.spaces).toHaveLength(1)
  })

  it('disables adding when server configuration is unavailable', () => {
    setup([], { enabled: false })
    expect(screen.getByRole('button', { name: /knowledgeFs.add/ })).toBeDisabled()
    expect(screen.getByText(/knowledgeFs.runtimeUnavailable/)).toBeInTheDocument()
  })

  it('does not offer additions when viewing a historical version', () => {
    setup([binding], { viewingVersion: true })
    expect(screen.queryByRole('button', { name: /knowledgeFs.add/ })).not.toBeInTheDocument()
  })

  it('keeps sibling composers isolated', async () => {
    const user = userEvent.setup()
    setup([binding], { label: 'first' })
    setup([], { label: 'second' })
    const firstAdd = screen.getAllByRole('button', { name: /knowledgeFs.add/ })[0]
    if (!firstAdd) throw new Error('First composer must expose an add button')
    await user.click(firstAdd)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Engineering' }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(
      JSON.parse(screen.getByLabelText('first').textContent ?? '{}').knowledge.spaces,
    ).toHaveLength(2)
    expect(
      JSON.parse(screen.getByLabelText('second').textContent ?? '{}').knowledge.spaces,
    ).toEqual([])
  })

  it('does not mutate a read-only composer', () => {
    setup([binding], { readOnly: true })
    expect(screen.getByRole('button', { name: /knowledgeFs.add/ })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: /knowledgeRetrieval.remove/ }),
    ).not.toBeInTheDocument()
  })

  it('rejects duplicate aliases at confirmation without changing the composer', async () => {
    const user = userEvent.setup()
    setup([binding])
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Engineering' }))
    const aliases = within(dialog).getAllByRole('textbox', { name: /knowledgeFs.alias/ })
    const secondAlias = aliases[1]
    if (!secondAlias) throw new Error('Second binding must expose an alias field')
    await user.clear(secondAlias)
    await user.type(secondAlias, 'Product manual')
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toBeInTheDocument()
    expect(snapshot().knowledge.spaces).toHaveLength(1)
  })
})

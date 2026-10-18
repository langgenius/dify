import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { KnowledgeSpaceCardTags } from '../knowledge-space-card-tags'

const api = vi.hoisted(() => ({
  putTags: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.tags.put>(),
  toast: { error: vi.fn(), success: vi.fn() },
}))

const knowledgeTags: Tag[] = [
  { binding_count: '1', id: 'tag-1', name: 'Frontend', type: 'knowledge' },
  { binding_count: '1', id: 'tag-2', name: 'Backend', type: 'knowledge' },
  { binding_count: '0', id: 'tag-3', name: 'Public docs', type: 'knowledge' },
]

vi.mock('@/app/notifications', () => ({ toast: api.toast }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.tags.put': api.putTags,
      'tags.get': async () => knowledgeTags,
    }),
  }
})

function createKnowledgeSpace(
  permissionKeys: KnowledgeFsSpaceListItemResponse['permission_keys'],
): KnowledgeFsSpaceListItemResponse {
  return {
    control_space_id: 'space-1',
    created_at: '2026-08-13T00:00:00Z',
    knowledge_space_id: 'knowledge-space-1',
    linked_apps: 0,
    owner_account_id: 'account-1',
    permission_keys: permissionKeys,
    resource_version: 1,
    state: 'active',
    tags: [
      { id: 'tag-1', name: 'Frontend', type: 'knowledge' },
      { id: 'tag-2', name: 'Backend', type: 'knowledge' },
    ],
    technical_status: 'available',
    technical_summary: {
      description: null,
      document_count: 0,
      icon: null,
      knowledge_space_id: 'knowledge-space-1',
      name: 'Public docs',
      revision: 1,
      slug: 'public-docs',
    },
    updated_at: '2026-08-13T00:00:00Z',
    visibility: 'only_me',
  }
}

const renderTags = (permissionKeys: KnowledgeFsSpaceListItemResponse['permission_keys']) =>
  renderWithConsoleQuery(
    <KnowledgeSpaceCardTags
      knowledgeSpace={createKnowledgeSpace(permissionKeys)}
      onOpenTagManagement={vi.fn()}
    />,
    { workspacePermissionKeys: ['dataset.tag.manage'] },
  )

const editable: KnowledgeFsSpaceListItemResponse['permission_keys'] = [
  'knowledge_space_edit',
  'knowledge_space_read',
]
const trigger = (name = 'Frontend, Backend: Public docs') => screen.getByRole('combobox', { name })

describe('KnowledgeSpaceCardTags', () => {
  beforeEach(() => {
    api.putTags.mockResolvedValue({ data: [] })
  })

  it('shows provided tag names read-only without space edit permission', () => {
    renderTags(['knowledge_space_read'])

    expect(trigger()).toBeDisabled()
    expect(screen.getByText('Frontend')).toBeInTheDocument()
    expect(screen.getByText('Backend')).toBeInTheDocument()
  })

  it('submits the final tag set and refreshes the list and binding counts', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderTags(editable)
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Frontend' }))
    await user.click(screen.getByRole('option', { name: 'Public docs' }))
    await user.click(trigger())

    await waitFor(() =>
      expect(api.toast.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully'),
    )
    expect(api.putTags).toHaveBeenCalledWith({
      body: { tag_ids: ['tag-2', 'tag-3'] },
      params: { control_space_id: 'space-1' },
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.tags.get.key({
        type: 'query',
        input: { query: { type: 'knowledge' } },
      }),
    })
  })

  it('serializes replacements against the latest submitted selection', async () => {
    const user = userEvent.setup()
    const firstReplacement = createDeferred<{ data: [] }>()
    api.putTags.mockReturnValueOnce(firstReplacement.promise)
    renderTags(editable)

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Frontend' }))
    await user.click(trigger())
    await waitFor(() => expect(api.putTags).toHaveBeenCalledOnce())

    const pendingTrigger = trigger('Backend: Public docs')
    await user.click(pendingTrigger)
    await user.click(await screen.findByRole('option', { name: 'Public docs' }))
    await user.click(pendingTrigger)

    expect(api.putTags).toHaveBeenCalledOnce()
    await act(async () => firstReplacement.resolve({ data: [] }))

    await waitFor(() => expect(api.putTags).toHaveBeenCalledTimes(2))
    expect(api.putTags.mock.calls.map(([input]) => input.body.tag_ids)).toEqual([
      ['tag-2'],
      ['tag-2', 'tag-3'],
    ])
  })

  it('can clear every tag from an editable knowledge space', async () => {
    const user = userEvent.setup()
    renderTags(editable)

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Frontend' }))
    await user.click(screen.getByRole('option', { name: 'Backend' }))
    await user.click(trigger())

    await waitFor(() =>
      expect(api.putTags).toHaveBeenCalledWith({
        body: { tag_ids: [] },
        params: { control_space_id: 'space-1' },
      }),
    )
  })
})

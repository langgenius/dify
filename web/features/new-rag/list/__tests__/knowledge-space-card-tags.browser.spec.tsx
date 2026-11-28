import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { consoleClient } from '@/service/console'
import { useQuery } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { KnowledgeSpaceCardTags } from '../knowledge-space-card-tags'

type KnowledgeFsSpaceListItemResponse = Awaited<
  ReturnType<typeof consoleClient.knowledgeFs.spaces.get>
>['data'][number]
type KnowledgeTag = Tag & { type: 'knowledge' }

const knowledgeTags: KnowledgeTag[] = [
  { binding_count: '1', id: 'tag-1', name: 'Frontend', type: 'knowledge' },
  { binding_count: '1', id: 'tag-2', name: 'Backend', type: 'knowledge' },
  { binding_count: '0', id: 'tag-3', name: 'Public docs', type: 'knowledge' },
]

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

const editable: KnowledgeFsSpaceListItemResponse['permission_keys'] = [
  'knowledge_space_edit',
  'knowledge_space_read',
]
let serverSpace: KnowledgeFsSpaceListItemResponse
let serverTags: KnowledgeTag[]
const trigger = (name = 'Frontend, Backend: Public docs') =>
  page.getByRole('combobox', { name, exact: true })
const option = (name: string) => page.getByRole('option', { name, exact: true })

// Apply refreshed query data through the same public props as the knowledge list.
function TagsOwner() {
  const { data } = useQuery(
    consoleQuery.knowledgeFs.spaces.get.queryOptions({
      input: { query: { limit: 30, page: 1 } },
    }),
  )
  return data?.data.map((space) => (
    <KnowledgeSpaceCardTags
      key={space.control_space_id}
      knowledgeSpace={space}
      onOpenTagManagement={() => {}}
    />
  ))
}
async function setup(permissionKeys = editable) {
  serverSpace = createKnowledgeSpace(permissionKeys)
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['dataset.tag.manage'],
  })
  await render(
    <QueryProvider>
      <div className="w-80">
        <TagsOwner />
      </div>
      <AppToaster />
    </QueryProvider>,
  )
  await expect.element(trigger()).toBeVisible()
  return queryClient
}
const fake = setupFakeApi(() => ({
  console: {
    knowledgeFs: {
      spaces: {
        get: async () => ({ data: [serverSpace], has_more: false, limit: 30, page: 1 }),
        byControlSpaceId: {
          tags: {
            put: async ({ body }) => {
              const tagIds = body.tag_ids ?? []
              serverSpace = {
                ...serverSpace,
                tags: serverTags.filter((tag) => tagIds.includes(tag.id)),
              }
              serverTags = serverTags.map((tag) => ({
                ...tag,
                binding_count: tagIds.includes(tag.id) ? '1' : '0',
              }))
              return { data: serverSpace.tags ?? [] }
            },
          },
        },
      },
    },
    tags: { get: async () => serverTags },
  },
}))
beforeEach(async () => {
  await page.viewport(640, 600)
  serverTags = knowledgeTags.map((tag) => ({ ...tag }))
})

it('keeps provided tags read-only without space edit permission even for a tag manager', async () => {
  await setup(['knowledge_space_read'])
  await expect.element(trigger()).toBeDisabled()
  await expect.element(trigger().getByText('Frontend', { exact: true })).toBeVisible()
  await expect.element(trigger().getByText('Backend', { exact: true })).toBeVisible()
})

it('saves the final selection on close and refreshes server tags and binding counts', async () => {
  const client = await setup()
  await trigger().click()
  await option('Frontend').click()
  await option('Public docs').click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  await expect.element(trigger('Backend, Public docs: Public docs')).toBeVisible()
  await expect
    .poll(() => fake.console.knowledgeFs.spaces.byControlSpaceId.tags.put.mock.calls)
    .toEqual([
      [
        {
          body: { tag_ids: ['tag-2', 'tag-3'] },
          params: { control_space_id: 'space-1' },
        },
      ],
    ])
  await expect
    .poll(() =>
      client.getQueryData(
        consoleQuery.tags.get.queryKey({ input: { query: { type: 'knowledge' } } }),
      ),
    )
    .toEqual([
      { ...knowledgeTags[0], binding_count: '0' },
      knowledgeTags[1],
      { ...knowledgeTags[2], binding_count: '1' },
    ])
  await trigger('Backend, Public docs: Public docs').click()
  await expect.element(option('Frontend')).toHaveAttribute('aria-selected', 'false')
  await expect.element(option('Backend')).toHaveAttribute('aria-selected', 'true')
  await expect.element(option('Public docs')).toHaveAttribute('aria-selected', 'true')
})

it('reopens with the submitted selection and serializes later edits while a replacement is pending', async () => {
  const firstReplacement = createDeferred<{ data: [] }>()
  fake.console.knowledgeFs.spaces.byControlSpaceId.tags.put.mockImplementationOnce(async () => {
    await firstReplacement.promise
    serverSpace = { ...serverSpace, tags: [knowledgeTags[1]!] }
    return { data: [] }
  })
  await setup()
  await trigger().click()
  await option('Frontend').click()
  await userEvent.keyboard('{Escape}')
  await expect
    .poll(() => fake.console.knowledgeFs.spaces.byControlSpaceId.tags.put.mock.calls.length)
    .toBe(1)
  await trigger('Backend: Public docs').click()
  await expect.element(option('Frontend')).toHaveAttribute('aria-selected', 'false')
  await expect.element(option('Backend')).toHaveAttribute('aria-selected', 'true')
  await option('Public docs').click()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger('Backend, Public docs: Public docs')).toBeVisible()
  expect(fake.console.knowledgeFs.spaces.byControlSpaceId.tags.put).toHaveBeenCalledOnce()
  firstReplacement.resolve({ data: [] })
  await expect
    .poll(() =>
      fake.console.knowledgeFs.spaces.byControlSpaceId.tags.put.mock.calls.map(
        ([input]) => input.body.tag_ids,
      ),
    )
    .toEqual([['tag-2'], ['tag-2', 'tag-3']])
  await trigger('Backend, Public docs: Public docs').click()
  await expect.element(option('Backend')).toHaveAttribute('aria-selected', 'true')
  await expect.element(option('Public docs')).toHaveAttribute('aria-selected', 'true')
})

it('persists an empty selection after every tag is removed', async () => {
  await setup()
  await trigger().click()
  await option('Frontend').click()
  await option('Backend').click()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger('common.tag.addTag: Public docs')).toBeVisible()
  await expect
    .poll(() => fake.console.knowledgeFs.spaces.byControlSpaceId.tags.put.mock.calls)
    .toEqual([
      [
        {
          body: { tag_ids: [] },
          params: { control_space_id: 'space-1' },
        },
      ],
    ])
  await trigger('common.tag.addTag: Public docs').click()
  await expect.element(option('Frontend')).toHaveAttribute('aria-selected', 'false')
  await expect.element(option('Backend')).toHaveAttribute('aria-selected', 'false')
})

it('shows its own text for a framework error code when the replacement fails', async () => {
  await setup()
  fake.console.knowledgeFs.spaces.byControlSpaceId.tags.put.mockRejectedValueOnce(
    apiError({ status: 400, code: 'bad_request', message: 'Server says why' }),
  )
  await trigger().click()
  await option('Frontend').click()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('dialog', { name: 'common.actionMsg.modifiedUnsuccessfully' }))
    .toBeVisible()
})

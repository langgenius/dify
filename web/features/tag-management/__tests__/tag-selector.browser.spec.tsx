import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { renderWithTags } from '@/test/tag-management'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TagSelector } from '../tag-selector'

const mocks = vi.hoisted(() => ({
  tags: [] as Tag[],
  list: vi.fn<() => Promise<Tag[]>>(),
  bind: vi.fn(),
  unbind: vi.fn(),
  create: vi.fn(),
}))
// boundary: supply tag API responses and observe which bindings the selector submits.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'tagBindings.post': (input: Parameters<typeof actual.consoleClient.tagBindings.post>[0]) =>
        mocks.bind(input),
      'tagBindings.remove.post': (
        input: Parameters<typeof actual.consoleClient.tagBindings.remove.post>[0],
      ) => mocks.unbind(input),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'tags.get': mocks.list,
      'tags.post': mocks.create,
    }),
  }
})
const tags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: '' },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: '' },
]
const firstTag = tags[0]!
const trigger = () => page.getByRole('combobox', { name: /Frontend/ })
const search = () => page.getByRole('combobox', { name: 'common.tag.selectorPlaceholder' })
function renderSelector(permissions = ['app.tag.manage'], canBindOrUnbindTags = false) {
  return renderWithTags(
    <TagSelector
      targetId="target-1"
      type="app"
      value={[firstTag]}
      canBindOrUnbindTags={canBindOrUnbindTags}
      contextLabel="Test App"
    />,
    mocks.tags,
    permissions,
  )
}
beforeEach(() => {
  mocks.tags = tags
  mocks.list.mockReset().mockImplementation(async () => mocks.tags)
  mocks.bind.mockReset().mockResolvedValue(undefined)
  mocks.unbind.mockReset().mockResolvedValue(undefined)
  mocks.create.mockReset().mockImplementation(async ({ body }) => ({ id: 'new-tag', ...body }))
})
afterEach(() => {
  toast.dismiss()
})

it('names the owning app and filters existing tags without offering a case-only duplicate', async () => {
  await renderSelector()
  await page.getByRole('combobox', { name: 'Frontend: Test App' }).click()
  await search().fill('frontend')
  await expect.element(page.getByRole('option', { name: 'Frontend' })).toBeVisible()
  await expect
    .element(page.getByRole('option', { name: /common\.tag\.create/ }))
    .not.toBeInTheDocument()
})

it('applies added tags only after closing and refreshes displayed names from the real query', async () => {
  mocks.bind.mockImplementation(async () => {
    mocks.tags = [{ ...firstTag, name: 'Frontend refreshed' }, tags[1]!]
  })
  await renderSelector()
  await trigger().click()
  await page.getByRole('option', { name: 'Backend' }).click()
  await expect
    .element(page.getByRole('option', { name: 'Backend' }))
    .toHaveAttribute('aria-selected', 'true')
  expect(mocks.bind).not.toHaveBeenCalled()
  await trigger().click()
  await expect.element(search()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('combobox', { name: 'Frontend refreshed: Test App' }))
    .toBeVisible()
  expect(mocks.bind).toHaveBeenCalledExactlyOnceWith({
    body: { tag_ids: ['tag-2'], target_id: 'target-1', type: 'app' },
  })
  await expect
    .element(page.getByText('common.actionMsg.modifiedSuccessfully', { exact: true }))
    .toBeVisible()
})

it('selects a highlighted tag with the keyboard and applies it when the popup closes', async () => {
  await renderSelector()
  await trigger().click()
  await search().fill('Back')
  await expect.element(page.getByRole('option', { name: 'Backend' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(page.getByRole('option', { name: 'Backend' }))
    .toHaveAttribute('data-highlighted')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('option', { name: 'Backend' }))
    .toHaveAttribute('aria-selected', 'true')
  await trigger().click()
  await expect
    .poll(() => mocks.bind.mock.calls)
    .toEqual([[{ body: { tag_ids: ['tag-2'], target_id: 'target-1', type: 'app' } }]])
})

it('applies removal on close and leaves unchanged selections alone', async () => {
  await renderSelector()
  await trigger().click()
  await expect.element(search()).toBeVisible()
  await trigger().click()
  await expect.element(search()).not.toBeInTheDocument()
  expect(mocks.bind).not.toHaveBeenCalled()
  expect(mocks.unbind).not.toHaveBeenCalled()
  await trigger().click()
  await page.getByRole('option', { name: 'Frontend' }).click()
  await expect
    .element(page.getByRole('option', { name: 'Frontend' }))
    .toHaveAttribute('aria-selected', 'false')
  expect(mocks.unbind).not.toHaveBeenCalled()
  await trigger().click()
  await expect
    .poll(() => mocks.unbind.mock.calls)
    .toEqual([[{ body: { tag_ids: ['tag-1'], target_id: 'target-1', type: 'app' } }]])
})

it('shows the binding failure after closing the popup', async () => {
  mocks.unbind.mockRejectedValueOnce(new Error('Unbind failed'))
  await renderSelector()
  await trigger().click()
  await page.getByRole('option', { name: 'Frontend' }).click()
  await trigger().click()
  await expect.element(search()).not.toBeInTheDocument()
  await expect.element(page.getByText('Unbind failed', { exact: true })).toBeVisible()
})

it('creates a knowledge tag without binding it implicitly', async () => {
  await renderWithTags(<TagSelector targetId="knowledge-1" type="knowledge" value={[]} />, tags)
  await page.getByRole('combobox', { name: 'common.tag.noTag' }).click()
  await search().fill('NewKnowledgeTag')
  await page.getByRole('option', { name: /NewKnowledgeTag/ }).click()
  await expect
    .poll(() => mocks.create.mock.calls)
    .toEqual([[{ body: { name: 'NewKnowledgeTag', type: 'knowledge' } }]])
  await expect.element(page.getByText('common.tag.created', { exact: true })).toBeVisible()
  expect(mocks.bind).not.toHaveBeenCalled()
})

it.each(['agent', 'app'] as const)(
  'offers to create the first %s tag only after the workspace catalog loads',
  async (type) => {
    const catalog = createDeferred<Tag[]>()
    mocks.list.mockReturnValue(catalog.promise)
    await renderWithTags(
      <TagSelector type={type} targetId="card-1" value={[]} canBindOrUnbindTags />,
      undefined,
      [`${type}.tag.manage`],
    )
    await page.getByRole('combobox', { name: 'common.tag.addTag' }).click()
    await expect.element(search()).toBeVisible()
    const hint = page.getByText('common.tag.noTagsYetCreateHint', { exact: true })
    await expect.element(hint).not.toBeInTheDocument()

    catalog.resolve([])
    await expect.element(hint).toBeVisible()
    await search().fill('Research')
    await expect
      .element(page.getByRole('option', { name: /common\.tag\.create.*Research/ }))
      .toBeVisible()
    await expect.element(hint).not.toBeInTheDocument()
  },
)

it('shows an empty tag catalog without inviting a binding-only editor to create a tag', async () => {
  mocks.tags = []
  await renderWithTags(
    <TagSelector type="agent" targetId="agent-1" value={[]} canBindOrUnbindTags />,
    mocks.tags,
    [],
  )
  await page.getByRole('combobox', { name: 'common.tag.addTag' }).click()
  await expect.element(page.getByText('common.tag.noTagsYet', { exact: true })).toBeVisible()
  await expect
    .element(page.getByText('common.tag.noTagsYetCreateHint', { exact: true }))
    .not.toBeInTheDocument()
})

it('does not offer to create the first tag when the Studio App catalog request fails', async () => {
  mocks.list.mockRejectedValue(new Error('Tag catalog unavailable'))
  const { queryClient } = await renderWithTags(
    <TagSelector type="app" targetId="app-1" value={[]} canBindOrUnbindTags />,
    undefined,
    ['app.tag.manage'],
  )
  await expect.poll(() => mocks.list.mock.calls.length).toBe(1)
  await expect.poll(() => queryClient.isFetching()).toBe(0)
  await page.getByRole('combobox', { name: 'common.tag.addTag' }).click()
  await expect.element(search()).toBeVisible()
  await expect
    .element(page.getByText('common.tag.noTagsYetCreateHint', { exact: true }))
    .not.toBeInTheDocument()
})

it.each(['before', 'after'] as const)(
  'saves a new Agent tag alongside the draft when closing %s creation completes',
  async (close) => {
    const agentTag = { id: 'existing', name: 'Existing', type: 'agent' }
    const newTag = { id: 'created', name: 'Research', type: 'agent' }
    mocks.tags = [agentTag]
    const creation = createDeferred<Tag>()
    const binding = createDeferred()
    mocks.create.mockReturnValueOnce(creation.promise)
    mocks.bind.mockReturnValueOnce(binding.promise)
    await renderWithTags(
      <TagSelector
        type="agent"
        targetId="agent-1"
        value={[]}
        requiresTargetEditPermission
        canBindOrUnbindTags
      />,
      mocks.tags,
      ['agent.tag.manage'],
    )
    const addTags = page.getByRole('combobox', { name: 'common.tag.addTag' })
    await addTags.click()
    await page.getByRole('option', { name: 'Existing' }).click()
    await search().fill('Research')
    await page.getByRole('option', { name: /common\.tag\.create/ }).click()
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      body: { name: 'Research', type: 'agent' },
    })
    if (close === 'before') {
      await userEvent.keyboard('{Escape}')
      await expect.element(search()).not.toBeInTheDocument()
      await expect.element(addTags).toHaveFocus()
      await expect.element(addTags).toHaveAttribute('aria-disabled', 'true')
      await userEvent.keyboard('{Enter}')
      await expect.element(search()).not.toBeInTheDocument()
    }
    mocks.tags = [newTag, agentTag]
    creation.resolve(newTag)
    if (close === 'after') {
      await expect
        .element(page.getByRole('option', { name: 'Research' }))
        .toHaveAttribute('aria-selected', 'true')
      expect(mocks.bind).not.toHaveBeenCalled()
      await userEvent.keyboard('{Escape}')
    }
    await expect
      .poll(() => mocks.bind.mock.calls)
      .toEqual([
        [{ body: { tag_ids: ['existing', 'created'], target_id: 'agent-1', type: 'agent' } }],
      ])
    await expect.element(addTags).toHaveFocus()
    await expect.element(addTags).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}')
    await expect.element(search()).not.toBeInTheDocument()
    binding.resolve()
    await expect.element(addTags).not.toHaveAttribute('aria-disabled')
    await expect.element(addTags).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(search()).toBeVisible()
  },
)

it('blocks opening without management permission or binding capability', async () => {
  await renderSelector([])
  await expect.element(trigger()).toBeDisabled()
  await expect.element(search()).not.toBeInTheDocument()
})

it('allows existing tag bindings without management permission but never offers creation or management', async () => {
  await renderSelector([], true)
  await trigger().click()
  await expect
    .element(page.getByRole('button', { name: 'common.tag.manageTags' }))
    .not.toBeInTheDocument()
  const searchExistingTags = page.getByRole('combobox', { name: 'common.tag.searchTags' })
  await searchExistingTags.fill('BrandNewTag')
  await expect.element(page.getByRole('option', { name: /BrandNewTag/ })).not.toBeInTheDocument()
  await searchExistingTags.fill('Back')
  await page.getByRole('option', { name: 'Backend' }).click()
  await trigger().click()
  await expect
    .poll(() => mocks.bind.mock.calls)
    .toEqual([[{ body: { tag_ids: ['tag-2'], target_id: 'target-1', type: 'app' } }]])
  expect(mocks.create).not.toHaveBeenCalled()
})

it('opens snippet tags using the snippet edit permission', async () => {
  const snippet = { id: 'snippet-tag-1', name: 'Reusable', type: 'snippet' as const }
  mocks.tags = [snippet]
  await renderWithTags(
    <TagSelector targetId="snippet-1" type="snippet" value={[snippet]} />,
    mocks.tags,
    ['snippets.create_and_modify'],
  )
  await page.getByRole('combobox', { name: 'Reusable' }).click()
  await expect
    .element(page.getByRole('option', { name: 'Reusable' }))
    .toHaveAttribute('aria-selected', 'true')
})

it.each([false, true])(
  'uses a reachable empty trigger for a missing catalog tag with binding capability %s',
  async (canBindOrUnbindTags) => {
    await renderWithTags(
      <TagSelector
        targetId="target-1"
        type="app"
        value={[{ id: 'orphan', name: 'Orphan', type: 'app' }]}
        canBindOrUnbindTags={canBindOrUnbindTags}
      />,
      tags,
    )
    const name = canBindOrUnbindTags ? 'common.tag.addTag' : 'common.tag.noTag'
    await expect.element(page.getByRole('combobox', { name })).toBeVisible()
    await expect.element(page.getByText('Orphan', { exact: true })).not.toBeInTheDocument()
    await page.getByRole('combobox', { name }).click()
    await expect
      .element(page.getByRole('option', { name: 'Orphan' }))
      .toHaveAttribute('aria-selected', 'true')
  },
)

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})

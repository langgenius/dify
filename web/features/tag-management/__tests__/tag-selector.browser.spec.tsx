import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { renderWithTags } from '@/test/tag-management'
import { TagSelector } from '../tag-selector'

let serverTags: Tag[] = []
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
    serverTags,
    permissions,
  )
}
const fake = setupFakeApi(() => ({
  console: {
    tags: { get: () => serverTags, post: ({ body }) => ({ id: 'new-tag', ...body }) },
    tagBindings: {
      post: () => ({ result: 'success' }),
      remove: { post: () => ({ result: 'success' }) },
    },
  },
}))
beforeEach(() => {
  serverTags = tags
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
  fake.console.tagBindings.post.mockImplementation(() => {
    serverTags = [{ ...firstTag, name: 'Frontend refreshed' }, tags[1]!]
    return { result: 'success' }
  })
  await renderSelector()
  await trigger().click()
  await page.getByRole('option', { name: 'Backend' }).click()
  await expect
    .element(page.getByRole('option', { name: 'Backend' }))
    .toHaveAttribute('aria-selected', 'true')
  expect(fake.console.tagBindings.post).not.toHaveBeenCalled()
  await trigger().click()
  await expect.element(search()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('combobox', { name: 'Frontend refreshed: Test App' }))
    .toBeVisible()
  expect(fake.console.tagBindings.post).toHaveBeenCalledExactlyOnceWith({
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
    .poll(() => fake.console.tagBindings.post.mock.calls)
    .toEqual([[{ body: { tag_ids: ['tag-2'], target_id: 'target-1', type: 'app' } }]])
})

it('applies removal on close and leaves unchanged selections alone', async () => {
  await renderSelector()
  await trigger().click()
  await expect.element(search()).toBeVisible()
  await trigger().click()
  await expect.element(search()).not.toBeInTheDocument()
  expect(fake.console.tagBindings.post).not.toHaveBeenCalled()
  expect(fake.console.tagBindings.remove.post).not.toHaveBeenCalled()
  await trigger().click()
  await page.getByRole('option', { name: 'Frontend' }).click()
  await expect
    .element(page.getByRole('option', { name: 'Frontend' }))
    .toHaveAttribute('aria-selected', 'false')
  expect(fake.console.tagBindings.remove.post).not.toHaveBeenCalled()
  await trigger().click()
  await expect
    .poll(() => fake.console.tagBindings.remove.post.mock.calls)
    .toEqual([[{ body: { tag_ids: ['tag-1'], target_id: 'target-1', type: 'app' } }]])
})

it('shows the binding failure after closing the popup', async () => {
  fake.console.tagBindings.remove.post.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Unbind failed' }),
  )
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
    .poll(() => fake.console.tags.post.mock.calls)
    .toEqual([[{ body: { name: 'NewKnowledgeTag', type: 'knowledge' } }]])
  await expect.element(page.getByText('common.tag.created', { exact: true })).toBeVisible()
  expect(fake.console.tagBindings.post).not.toHaveBeenCalled()
})

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
  await search().fill('BrandNewTag')
  await expect.element(page.getByRole('option', { name: /BrandNewTag/ })).not.toBeInTheDocument()
  await search().fill('Back')
  await page.getByRole('option', { name: 'Backend' }).click()
  await trigger().click()
  await expect
    .poll(() => fake.console.tagBindings.post.mock.calls)
    .toEqual([[{ body: { tag_ids: ['tag-2'], target_id: 'target-1', type: 'app' } }]])
  expect(fake.console.tags.post).not.toHaveBeenCalled()
})

it('opens snippet tags using the snippet edit permission', async () => {
  const snippet = { id: 'snippet-tag-1', name: 'Reusable', type: 'snippet' as const }
  serverTags = [snippet]
  await renderWithTags(
    <TagSelector targetId="snippet-1" type="snippet" value={[snippet]} />,
    serverTags,
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

import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { emulateReducedMotion } from '@/test/browser-media-emulation'
import { createDeferred } from '@/test/deferred'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { renderWithTags } from '@/test/tag-management'
import { CompactTagFilter, TagFilter } from '../tag-filter'
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
  vi.unstubAllGlobals()
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

it.each(['app', 'agent'] as const)(
  'keeps the %s tag options visible while the popup fades out',
  async (type) => {
    await emulateReducedMotion(false)
    vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
    serverTags = tags.map((tag) => ({ ...tag, type }))
    await renderWithTags(
      <TagSelector
        type={type}
        targetId="card-1"
        value={[{ ...firstTag, type }]}
        canBindOrUnbindTags
      />,
      serverTags,
      [`${type}.tag.manage`],
    )
    await trigger().click()
    await expect.element(search()).toHaveFocus()
    const dialog = page.getByRole('dialog', { name: 'Frontend' })
    await expect.element(dialog.getByRole('option', { name: 'Frontend' })).toBeVisible()
    await expect.element(dialog.getByRole('option', { name: 'Backend' })).toBeVisible()
    const popup = dialog.element()
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')

    const exitFrame = createDeferred<{ opacity: number; options: string[]; text: string }>()
    const captureExit = (event: Event) => {
      if (!(event instanceof TransitionEvent)) return
      if (event.target !== popup || event.propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', captureExit)
      exitFrame.resolve({
        opacity: Number(getComputedStyle(popup).opacity),
        options: Array.from(
          popup.querySelectorAll('[role="option"]'),
          (option) => option.textContent?.trim() ?? '',
        ),
        text: popup.textContent ?? '',
      })
    }
    popup.addEventListener('transitionrun', captureExit)
    await userEvent.keyboard('{Escape}')
    const frame = await exitFrame.promise
    expect(frame.opacity).toBeGreaterThan(0)
    expect(frame.options).toEqual(['Frontend', 'Backend'])
    expect(frame.text).not.toContain('common.tag.noTagsYetCreateHint')
    await expect.poll(() => popup.isConnected).toBe(false)
  },
)

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
  // Both closes share the apply path, so a spurious binding from either would have arrived by now.
  expect(fake.console.tagBindings.post).not.toHaveBeenCalled()
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

it('shows one error toast when a new tag name crosses the length limit', async () => {
  await renderSelector()
  await trigger().click()
  await search().fill('A'.repeat(51))
  const message = 'common.tag.nameTooLong:{"max":50}'
  const notifications = page.getByRole('region', { name: 'Notifications' })
  await expect.element(notifications.getByRole('dialog', { name: message })).toBeVisible()
  await expect
    .element(page.getByRole('dialog', { name: 'Frontend: Test App' }).getByText(message))
    .not.toBeInTheDocument()
  await search().fill('A'.repeat(52))
  expect(notifications.getByRole('dialog').all()).toHaveLength(1)
  await expect
    .element(page.getByRole('option', { name: /common\.tag\.create/ }))
    .not.toBeInTheDocument()
  await search().fill('A'.repeat(50))
  await expect.element(page.getByRole('option', { name: /common\.tag\.create/ })).toBeVisible()
})

it.each(['agent', 'app'] as const)(
  'offers to create the first %s tag only after the workspace catalog loads',
  async (type) => {
    const catalog = createDeferred<Tag[]>()
    fake.console.tags.get.mockImplementation(() => catalog.promise)
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
  serverTags = []
  await renderWithTags(
    <TagSelector type="agent" targetId="agent-1" value={[]} canBindOrUnbindTags />,
    serverTags,
    [],
  )
  await page.getByRole('combobox', { name: 'common.tag.addTag' }).click()
  await expect.element(page.getByText('common.tag.noTagsYet', { exact: true })).toBeVisible()
  await expect
    .element(page.getByText('common.tag.noTagsYetCreateHint', { exact: true }))
    .not.toBeInTheDocument()
})

it('does not offer to create the first tag when the Studio App catalog request fails', async () => {
  fake.console.tags.get.mockRejectedValue(
    apiError({ status: 503, message: 'Tag catalog unavailable' }),
  )
  const { queryClient } = await renderWithTags(
    <TagSelector type="app" targetId="app-1" value={[]} canBindOrUnbindTags />,
    undefined,
    ['app.tag.manage'],
  )
  await expect.poll(() => fake.console.tags.get.mock.calls.length).toBe(1)
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
    serverTags = [agentTag]
    const creation = hold(fake.console.tags.post)
    const binding = hold(fake.console.tagBindings.post)
    await renderWithTags(
      <>
        <TagFilter type="agent" value={[]} onChange={vi.fn()} />
        <TagSelector
          type="agent"
          targetId="agent-1"
          value={[]}
          requiresTargetEditPermission
          canBindOrUnbindTags
        />
      </>,
      serverTags,
      ['agent.tag.manage'],
    )
    const addTags = page.getByRole('combobox', { name: 'common.tag.addTag' })
    await addTags.click()
    await page.getByRole('option', { name: 'Existing' }).click()
    await search().fill('Research')
    await page.getByRole('option', { name: /common\.tag\.create/ }).click()
    await creation.arrived
    expect(fake.console.tags.post).toHaveBeenCalledExactlyOnceWith({
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
    const catalogRefresh = hold(fake.console.tags.get)
    serverTags = [newTag, agentTag]
    creation.resolve(newTag)
    if (close === 'after') {
      await expect
        .element(page.getByRole('option', { name: 'Research' }))
        .toHaveAttribute('aria-selected', 'true')
      expect(fake.console.tagBindings.post).not.toHaveBeenCalled()
      await userEvent.keyboard('{Escape}')
    }
    await expect
      .poll(() => fake.console.tagBindings.post.mock.calls)
      .toEqual([
        [{ body: { tag_ids: ['existing', 'created'], target_id: 'agent-1', type: 'agent' } }],
      ])
    expect(fake.console.tags.get).not.toHaveBeenCalled()
    await expect.element(addTags).toHaveFocus()
    await expect.element(addTags).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}')
    await expect.element(search()).not.toBeInTheDocument()
    serverTags = serverTags.map((tag) => ({ ...tag, binding_count: '1' }))
    binding.release()
    await catalogRefresh.arrived
    catalogRefresh.release()
    await expect.element(addTags).not.toHaveAttribute('aria-disabled')
    expect(fake.console.tags.get).toHaveBeenCalledExactlyOnceWith({ query: { type: 'agent' } })
    await expect.element(addTags).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(search()).toBeVisible()
  },
)

it('refreshes the Agent tag catalog when the new tag is deselected before saving', async () => {
  const newTag = { id: 'created', name: 'Research', type: 'agent' }
  serverTags = []
  fake.console.tags.post.mockImplementationOnce(() => {
    serverTags = [newTag]
    return newTag
  })
  await renderWithTags(
    <>
      <TagFilter type="agent" value={[]} onChange={vi.fn()} />
      <TagSelector type="agent" targetId="agent-1" value={[]} canBindOrUnbindTags />
    </>,
    serverTags,
    ['agent.tag.manage'],
  )
  await page.getByRole('combobox', { name: 'common.tag.addTag' }).click()
  await search().fill('Research')
  await page.getByRole('option', { name: /common\.tag\.create/ }).click()
  const option = page.getByRole('option', { name: 'Research' })
  await expect.element(option).toHaveAttribute('aria-selected', 'true')
  expect(fake.console.tags.get).not.toHaveBeenCalled()
  await option.click()
  await userEvent.keyboard('{Escape}')
  await expect.element(search()).not.toBeInTheDocument()
  await expect
    .poll(() => fake.console.tags.get.mock.calls)
    .toEqual([[{ query: { type: 'agent' } }]])
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
  const searchExistingTags = page.getByRole('combobox', { name: 'common.tag.searchTags' })
  await searchExistingTags.fill('BrandNewTag')
  await expect.element(page.getByRole('option', { name: /BrandNewTag/ })).not.toBeInTheDocument()
  await searchExistingTags.fill('Back')
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

it('shows a failed tag catalog load in the selector with a retry instead of an empty catalog', async () => {
  fake.console.tags.get.mockRejectedValueOnce(
    apiError({ status: 503, message: 'Tags unavailable' }),
  )
  await renderWithTags(
    <TagSelector
      targetId="target-1"
      type="app"
      value={[]}
      canBindOrUnbindTags
      contextLabel="Test App"
    />,
    undefined,
    ['app.tag.manage'],
  )
  await page.getByRole('combobox', { name: 'common.tag.addTag: Test App' }).click()

  await expect
    .element(page.getByRole('alert').getByText('common.dynamicSelect.error'))
    .toBeVisible()
  await page.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(page.getByRole('option', { name: 'Frontend' })).toBeVisible()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
})

it('shows a failed tag catalog load in the compact filter with a retry', async () => {
  fake.console.tags.get.mockRejectedValueOnce(
    apiError({ status: 503, message: 'Tags unavailable' }),
  )
  await renderWithTags(<CompactTagFilter type="app" value={[]} onChange={vi.fn()} />, undefined, [
    'app.tag.manage',
  ])
  await page.getByRole('button', { name: 'common.tag.placeholder' }).click()

  await expect
    .element(page.getByRole('alert').getByText('common.dynamicSelect.error'))
    .toBeVisible()
  await expect.element(page.getByText('common.tag.noTag')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(page.getByRole('checkbox', { name: 'Frontend' })).toBeVisible()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
})

it('shows a failed tag catalog load in the filter with a retry instead of an empty catalog', async () => {
  fake.console.tags.get.mockRejectedValueOnce(
    apiError({ status: 503, message: 'Tags unavailable' }),
  )
  await renderWithTags(<TagFilter type="app" value={[]} onChange={vi.fn()} />, undefined, [
    'app.tag.manage',
  ])
  await page.getByRole('combobox', { name: 'common.tag.placeholder' }).click()

  await expect
    .element(page.getByRole('alert').getByText('common.dynamicSelect.error'))
    .toBeVisible()
  await page.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(page.getByRole('option', { name: 'Frontend' })).toBeVisible()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
})

import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { renderWithTags } from '@/test/tag-management'
import { TagManagementDialog } from '../tag-management-dialog'

const tags = [
  { id: 'tag-1', name: 'Frontend', type: 'app' as const, binding_count: '' },
  { id: 'tag-2', name: 'Backend', type: 'app' as const, binding_count: '' },
]
function renderModal(
  type: TagType = 'app',
  permissions = ['app.tag.manage', 'dataset.tag.manage', 'snippets.create_and_modify'],
  /** `null` leaves the tag list unseeded so it is requested. */
  seededTags: typeof tags | null = tags,
) {
  function Owner() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button onClick={() => setOpen(true)}>Manage tags</button>
        <TagManagementDialog type={type} show={open} onClose={() => setOpen(false)} />
      </>
    )
  }
  return renderWithTags(<Owner />, seededTags ?? undefined, permissions)
}
const input = () => page.getByRole('textbox', { name: 'common.tag.addNew' })
const dialog = () => page.getByRole('dialog', { name: 'common.tag.manageTags' })
const notifications = () => page.getByRole('region', { name: 'Notifications' })
const fake = setupFakeApi(() => ({
  console: {
    tags: {
      get: () => tags,
      post: ({ body }) => ({ id: 'new-tag', binding_count: '', ...body }),
      byTagId: { patch: ({ params, body }) => ({ id: params.tag_id, ...body }) },
    },
  },
}))
afterEach(() => {
  toast.dismiss()
})

it.each(['app', 'knowledge', 'snippet'] as const)(
  'creates a %s tag and clears the successful draft',
  async (type) => {
    await renderModal(type)
    await input().fill('  NewTag  ')
    await userEvent.keyboard('{Enter}')
    await expect.element(input()).toHaveValue('')
    expect(fake.console.tags.post).toHaveBeenCalledExactlyOnceWith({
      body: { name: 'NewTag', type },
    })
    await expect.element(page.getByText('common.tag.created', { exact: true })).toBeVisible()
  },
)

it('submits on blur and locks the pending draft against edits and duplicate submission', async () => {
  const pending = hold(fake.console.tags.post)
  await renderModal()
  await expect.element(page.getByText('Frontend', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
  await input().fill('Pending')
  await userEvent.tab()
  await expect.element(input()).toHaveAttribute('readonly')
  await input().click()
  await userEvent.keyboard('changed{Enter}')
  await userEvent.tab()
  await expect.element(input()).toHaveValue('Pending')
  expect(fake.console.tags.post).toHaveBeenCalledOnce()
  pending.resolve({ id: 'new-tag', name: 'Pending', type: 'app', binding_count: '' })
  await expect.element(input()).toHaveValue('')
  await expect.element(input()).not.toHaveAttribute('readonly')
})

it('keeps a failed draft available for correction and retry', async () => {
  fake.console.tags.post.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Creation failed' }),
  )
  await renderModal()
  await input().fill('FailTag')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Creation failed', { exact: true })).toBeVisible()
  await expect.element(input()).toHaveValue('FailTag')
  await expect.element(input()).not.toHaveAttribute('readonly')
  await input().fill('Corrected')
  await userEvent.keyboard('{Enter}')
  await expect.element(input()).toHaveValue('')
  expect(fake.console.tags.post).toHaveBeenLastCalledWith({
    body: { name: 'Corrected', type: 'app' },
  })
})

it('translates a server-side name length error without displaying its JSON', async () => {
  const message = JSON.stringify([{ loc: ['name'], type: 'string_too_long' }])
  fake.console.tags.post.mockRejectedValueOnce(apiError({ status: 422, message }))
  await renderModal()
  await input().fill('Research')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(notifications().getByRole('dialog', { name: 'common.tag.nameTooLong:{"max":50}' }))
    .toBeVisible()
  await expect.element(input()).toHaveValue('Research')
  await expect.element(page.getByText(message, { exact: true })).not.toBeInTheDocument()
})

it('rejects whitespace-only names and lets the user correct the draft', async () => {
  await renderModal()
  await input().fill('   ')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(notifications().getByRole('dialog', { name: 'common.tag.nameRequired' }))
    .toBeVisible()
  await userEvent.tab()
  expect(notifications().getByRole('dialog').all()).toHaveLength(1)
  expect(fake.console.tags.post).not.toHaveBeenCalled()
  // The next real submission goes through the same path, so an empty request would precede it.
  await input().fill('NextTag')
  await userEvent.keyboard('{Enter}')
  await expect.element(input()).toHaveValue('')
  expect(fake.console.tags.post).toHaveBeenCalledExactlyOnceWith({
    body: { name: 'NextTag', type: 'app' },
  })
})

it('checks normalized names against other loaded Agent tags on create and rename', async () => {
  const research = {
    id: '6c1f5d0a-8e2b-4c3d-9f7a-1b2c3d4e5f60',
    type: 'agent',
    name: '  Research  ',
  }
  const finance = { ...research, id: '7d2e6f1b-9f3c-4d4e-8a8b-2c3d4e5f6071', name: 'Finance' }
  const catalog = [research, finance]
  fake.console.tags.get.mockReturnValue(catalog)
  await renderWithTags(<TagManagementDialog type="agent" show onClose={() => {}} />, catalog, [
    'agent.tag.manage',
  ])
  await input().fill('Research')
  await userEvent.keyboard('{Enter}')
  const conflicts = notifications().getByRole('dialog', { name: 'common.tag.nameAlreadyExists' })
  await expect.element(conflicts).toBeVisible()
  expect(fake.console.tags.post).not.toHaveBeenCalled()

  await dialog().getByRole('button', { name: 'common.operation.edit Finance' }).click()
  const rename = dialog().getByRole('textbox', { name: 'common.operation.rename Finance' })
  await rename.fill(' Research ')
  await userEvent.keyboard('{Enter}')
  await expect.element(rename).toHaveAttribute('aria-invalid', 'true')
  expect(conflicts.all()).toHaveLength(2)
  expect(fake.console.tags.byTagId.patch).not.toHaveBeenCalled()

  await dialog().getByRole('button', { name: 'common.operation.edit Research' }).click()
  const ownName = dialog().getByRole('textbox', { name: 'common.operation.rename Research' })
  await ownName.fill('Research')
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => fake.console.tags.byTagId.patch.mock.calls)
    .toEqual([[{ params: { tag_id: research.id }, body: { name: 'Research' } }]])
})

it.each(['button', 'Escape'])('dismisses management with %s', async (method) => {
  await renderModal()
  if (method === 'button')
    await page.getByRole('button', { name: 'common.operation.close' }).click()
  else await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).not.toBeInTheDocument()
})

it('hides management controls without workspace permission', async () => {
  await renderModal('app', [])
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(input()).not.toBeInTheDocument()
})

it('shows a failed tag list load with a retry instead of an empty tag list', async () => {
  fake.console.tags.get.mockRejectedValueOnce(
    apiError({ status: 503, message: 'Tags unavailable' }),
  )
  await renderModal('app', undefined, null)

  await expect
    .element(dialog().getByRole('alert').getByText('common.dynamicSelect.error'))
    .toBeVisible()
  await dialog().getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(dialog().getByText('Frontend')).toBeVisible()
  await expect.element(dialog().getByRole('alert')).not.toBeInTheDocument()
})

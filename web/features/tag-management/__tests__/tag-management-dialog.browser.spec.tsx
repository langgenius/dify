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
  return renderWithTags(<Owner />, tags, permissions)
}
const input = () => page.getByRole('textbox', { name: 'common.tag.addNew' })
const dialog = () => page.getByRole('dialog', { name: 'common.tag.manageTags' })
const fake = setupFakeApi(() => ({
  console: {
    tags: {
      get: () => tags,
      post: ({ body }) => ({ id: 'new-tag', binding_count: '', ...body }),
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
    await input().fill('NewTag')
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

it('rejects whitespace-only names and lets the user correct the draft', async () => {
  await renderModal()
  await input().fill('   ')
  await userEvent.keyboard('{Enter}')
  await expect.element(input()).toHaveAccessibleDescription('common.tag.nameRequired')
  await userEvent.tab()
  expect(fake.console.tags.post).not.toHaveBeenCalled()
  // The next real submission goes through the same path, so an empty request would precede it.
  await input().fill('NextTag')
  await userEvent.keyboard('{Enter}')
  await expect.element(input()).toHaveValue('')
  expect(fake.console.tags.post).toHaveBeenCalledExactlyOnceWith({
    body: { name: 'NextTag', type: 'app' },
  })
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

import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TagManagementModal } from '../components/tag-management-modal'
import { renderWithTags } from './render-browser'

const { createTag } = vi.hoisted(() => ({ createTag: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'tags.post': createTag }),
  }
})
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
        <TagManagementModal type={type} show={open} onClose={() => setOpen(false)} />
      </>
    )
  }
  return renderWithTags(<Owner />, tags, permissions)
}
const input = () => page.getByRole('textbox', { name: 'common.tag.addNew' })
const dialog = () => page.getByRole('dialog', { name: 'common.tag.manageTags' })
beforeEach(() => {
  createTag
    .mockReset()
    .mockImplementation(async ({ body }) => ({ id: 'new-tag', binding_count: '', ...body }))
})
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
    expect(createTag).toHaveBeenCalledExactlyOnceWith({ body: { name: 'NewTag', type } })
    await expect.element(page.getByText('common.tag.created', { exact: true })).toBeVisible()
  },
)

it('submits on blur and locks the pending draft against edits and duplicate submission', async () => {
  const pending = createDeferred<unknown>()
  createTag.mockReturnValueOnce(pending.promise)
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
  expect(createTag).toHaveBeenCalledOnce()
  pending.resolve({ id: 'new-tag', name: 'Pending', type: 'app' })
  await expect.element(input()).toHaveValue('')
  await expect.element(input()).not.toHaveAttribute('readonly')
})

it('keeps a failed draft available for correction and retry', async () => {
  createTag.mockRejectedValueOnce(new Error('Creation failed'))
  await renderModal()
  await input().fill('FailTag')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Creation failed', { exact: true })).toBeVisible()
  await expect.element(input()).toHaveValue('FailTag')
  await expect.element(input()).not.toHaveAttribute('readonly')
  await input().fill('Corrected')
  await userEvent.keyboard('{Enter}')
  await expect.element(input()).toHaveValue('')
  expect(createTag).toHaveBeenLastCalledWith({ body: { name: 'Corrected', type: 'app' } })
})

it('ignores empty submissions through Enter and blur', async () => {
  await renderModal()
  await input().click()
  await userEvent.keyboard('{Enter}')
  await userEvent.tab()
  expect(createTag).not.toHaveBeenCalled()
  await expect.element(dialog()).toBeVisible()
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
  expect(createTag).not.toHaveBeenCalled()
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})

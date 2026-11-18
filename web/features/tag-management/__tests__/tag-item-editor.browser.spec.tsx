import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { apiError, installFakeApi } from '@/test/fake-api'
import { TagManagementModal } from '../components/tag-management-modal'
import { renderWithTags } from './render-browser'

const mocks = { update: vi.fn(), remove: vi.fn(), tags: [] as Tag[] }
// Tag routes address tags by UUID.
const frontendId = '6c1f5d0a-8e2b-4c3d-9f7a-1b2c3d4e5f60'
const backendId = '7d2e6f1b-9f3c-4d4e-8a8b-2c3d4e5f6071'
const baseTag: Tag = { id: frontendId, name: 'Frontend', type: 'app', binding_count: '3' }
function renderEditor(bindingCount = '3') {
  mocks.tags = [
    { ...baseTag, binding_count: bindingCount },
    { ...baseTag, id: backendId, name: 'Backend', binding_count: '' },
  ]
  return renderWithTags(<TagManagementModal type="app" show onClose={() => {}} />, mocks.tags)
}
const edit = () => page.getByRole('button', { name: 'common.operation.edit Frontend' })
const remove = () => page.getByRole('button', { name: 'common.operation.remove Frontend' })
const input = () => page.getByRole('textbox', { name: 'common.operation.rename Frontend' })
const confirmation = () => page.getByRole('alertdialog', { name: 'common.tag.delete "Frontend"' })
beforeEach(() => {
  mocks.update.mockReset().mockResolvedValue(undefined)
  mocks.remove.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  toast.dismiss()
})

it('explains the binding count without naming a particular resource type', async () => {
  await renderEditor()
  await page.getByText('3', { exact: true }).first().hover()
  await expect.element(page.getByText('common.tag.boundItems', { exact: true })).toBeVisible()
})

it('renames a tag through the real management list and exits editing', async () => {
  await renderEditor()
  await edit().click()
  await expect.element(input()).toHaveFocus()
  await input().fill('Frontend V2')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Frontend V2', { exact: true })).toBeVisible()
  await expect.element(input()).not.toBeInTheDocument()
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
    params: { tag_id: frontendId },
    body: { name: 'Frontend V2' },
  })
})

it('leaves unchanged names alone and rejects an empty rename without losing the tag', async () => {
  await renderEditor()
  await edit().click()
  await expect.element(input()).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(input()).not.toBeInTheDocument()
  expect(mocks.update).not.toHaveBeenCalled()
  await edit().click()
  await input().fill('')
  await userEvent.tab()
  await expect.element(page.getByText('tag name is empty', { exact: true })).toBeVisible()
  await expect.element(input()).not.toBeInTheDocument()
  await expect.element(edit()).toBeVisible()
  expect(mocks.update).not.toHaveBeenCalled()
})

it('shows a rename failure and restores the original name for editing again', async () => {
  mocks.update.mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE', 503, 'Update failed'))
  await renderEditor()
  await edit().click()
  await input().fill('Broken Name')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Update failed', { exact: true })).toBeVisible()
  await expect.element(input()).not.toBeInTheDocument()
  await edit().click()
  await expect.element(input()).toHaveValue('Frontend')
})

it('removes an unbound tag from the real list without a success notification', async () => {
  await renderEditor('0')
  await remove().click()
  await expect.element(page.getByText('Frontend', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ params: { tag_id: frontendId } })
  await expect
    .element(page.getByRole('region', { name: 'Notifications' }).getByRole('dialog'))
    .not.toBeInTheDocument()
})

it('keeps a pending deletion single-submission and removes the tag only after completion', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const pending = createDeferred<void>()
    mocks.remove.mockReturnValueOnce(pending.promise)
    await renderEditor('0')
    await remove().click()
    await vi.advanceTimersByTimeAsync(200)
    await expect.poll(() => mocks.remove).toHaveBeenCalledOnce()
    await expect.element(page.getByText('Frontend', { exact: true })).toBeVisible()
    await remove().click()
    await vi.advanceTimersByTimeAsync(200)
    expect(mocks.remove).toHaveBeenCalledOnce()
    pending.resolve()
    await expect.element(page.getByText('Frontend', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
  } finally {
    vi.useRealTimers()
  }
})

it('cancels a bound-tag deletion without changing the list and deletes after confirmation', async () => {
  await renderEditor()
  await remove().click()
  await expect.element(confirmation()).toBeVisible()
  await confirmation().getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(confirmation()).not.toBeInTheDocument()
  await expect.element(remove()).toBeVisible()
  expect(mocks.remove).not.toHaveBeenCalled()
  await remove().click()
  await confirmation().getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(confirmation()).not.toBeInTheDocument()
  await expect.element(page.getByText('Frontend', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
})

it('shows a deletion error and keeps both tags available', async () => {
  mocks.remove.mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE', 503, 'Delete failed'))
  await renderEditor('0')
  await remove().click()
  await expect.element(page.getByText('Delete failed', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Frontend', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
})

beforeEach(() => {
  onTestFinished(
    installFakeApi({
      console: {
        tags: {
          get: () => mocks.tags,
          byTagId: {
            patch: async (input) => {
              await mocks.update(input)
              const updated = {
                ...mocks.tags.find((tag) => tag.id === input.params.tag_id)!,
                name: input.body.name,
              }
              mocks.tags = mocks.tags.map((tag) => (tag.id === input.params.tag_id ? updated : tag))
              return updated
            },
            delete: async (input) => {
              await mocks.remove(input)
              mocks.tags = mocks.tags.filter((tag) => tag.id !== input.params.tag_id)
            },
          },
        },
      },
    }),
  )
})

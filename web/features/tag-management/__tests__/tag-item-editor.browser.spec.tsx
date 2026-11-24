import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { renderWithTags } from '@/test/tag-management'
import { TagManagementDialog } from '../tag-management-dialog'

let serverTags: Tag[] = []
// Tag routes address tags by UUID.
const frontendId = '6c1f5d0a-8e2b-4c3d-9f7a-1b2c3d4e5f60'
const backendId = '7d2e6f1b-9f3c-4d4e-8a8b-2c3d4e5f6071'
const baseTag: Tag = { id: frontendId, name: 'Frontend', type: 'app', binding_count: '3' }
function renderEditor(bindingCount = '3', [name, otherName] = [baseTag.name, 'Backend']) {
  serverTags = [
    { ...baseTag, name, binding_count: bindingCount },
    { ...baseTag, id: backendId, name: otherName, binding_count: '' },
  ]
  return renderWithTags(<TagManagementDialog type="app" show onClose={() => {}} />, serverTags)
}
const edit = () => page.getByRole('button', { name: 'common.operation.edit Frontend' })
const remove = () => page.getByRole('button', { name: 'common.operation.remove Frontend' })
const input = () => page.getByRole('textbox', { name: 'common.operation.rename Frontend' })
const confirmation = () => page.getByRole('alertdialog', { name: 'common.tag.delete "Frontend"' })
const fake = setupFakeApi(() => ({
  console: {
    tags: {
      get: () => serverTags,
      byTagId: {
        patch: ({ params, body }) => {
          const updated = {
            ...serverTags.find((tag) => tag.id === params.tag_id)!,
            name: body.name,
          }
          serverTags = serverTags.map((tag) => (tag.id === params.tag_id ? updated : tag))
          return updated
        },
        delete: ({ params }) => {
          serverTags = serverTags.filter((tag) => tag.id !== params.tag_id)
        },
      },
    },
  },
}))
afterEach(() => {
  toast.dismiss()
})

it('explains the binding count without naming a particular resource type', async () => {
  await renderEditor()
  await page.getByText('3', { exact: true }).first().hover()
  await expect.element(page.getByText('common.tag.boundItems', { exact: true })).toBeVisible()
})

it.each([1512, 320])(
  'shows distinct full-length tag names and keeps their actions reachable at %i px',
  async (width) => {
    await page.viewport(width, 800)
    const prefix = 'W'.repeat(49)
    const firstName = `${prefix}A`
    const secondName = `${prefix}B`
    await renderEditor('0', [firstName, secondName])
    const dialog = page.getByRole('dialog', { name: 'common.tag.manageTags' })
    for (const name of [firstName, secondName]) {
      const label = dialog.getByText(name, { exact: true })
      await expect.element(label).toBeVisible()
      const element = label.element()
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
    }

    await dialog.getByRole('button', { name: `common.operation.remove ${secondName}` }).click()
    await expect.element(dialog.getByText(secondName, { exact: true })).not.toBeInTheDocument()
    expect(fake.console.tags.byTagId.delete).toHaveBeenCalledExactlyOnceWith({
      params: { tag_id: backendId },
    })
    await dialog.getByRole('button', { name: `common.operation.edit ${firstName}` }).click()
    await expect
      .element(dialog.getByRole('textbox', { name: `common.operation.rename ${firstName}` }))
      .toHaveValue(firstName)
  },
)

it('renames a tag through the real management list and exits editing', async () => {
  await renderEditor()
  await edit().click()
  await expect.element(input()).toHaveFocus()
  await input().fill('  Frontend V2  ')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Frontend V2', { exact: true })).toBeVisible()
  await expect.element(input()).not.toBeInTheDocument()
  expect(fake.console.tags.byTagId.patch).toHaveBeenCalledExactlyOnceWith({
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
  expect(fake.console.tags.byTagId.patch).not.toHaveBeenCalled()
  await edit().click()
  await input().fill('   ')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog', { name: 'common.tag.nameRequired' })).toBeVisible()
  await expect.element(input()).toHaveValue('   ')
  expect(fake.console.tags.byTagId.patch).not.toHaveBeenCalled()
})

it('preserves an existing padded tag name when the user leaves without editing', async () => {
  const name = '  Frontend  '
  await renderEditor('3', [name, 'Backend'])
  await edit().click()
  await expect.element(input()).toHaveValue(name)
  await userEvent.tab()
  await expect.element(edit()).toBeVisible()
  expect(fake.console.tags.byTagId.patch).not.toHaveBeenCalled()
})

it('shows a rename failure and restores the original name for editing again', async () => {
  fake.console.tags.byTagId.patch.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Update failed' }),
  )
  await renderEditor()
  await edit().click()
  await input().fill('Broken Name')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Update failed', { exact: true })).toBeVisible()
  await expect.element(input()).not.toBeInTheDocument()
  await edit().click()
  await expect.element(input()).toHaveValue('Frontend')
})

it('rejects 51 code points before saving and accepts a 50-character replacement', async () => {
  const validName = '🔖'.repeat(50)
  await renderEditor()
  await edit().click()
  await input().fill(`${validName}x`)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('dialog', { name: 'common.tag.nameTooLong:{"max":50}' }))
    .toBeVisible()
  expect(fake.console.tags.byTagId.patch).not.toHaveBeenCalled()
  await input().fill(validName)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText(validName, { exact: true })).toBeVisible()
  expect(fake.console.tags.byTagId.patch).toHaveBeenCalledExactlyOnceWith({
    params: { tag_id: frontendId },
    body: { name: validName },
  })
})

it('removes an unbound tag from the real list without a success notification', async () => {
  await renderEditor('0')
  await remove().click()
  await expect.element(page.getByText('Frontend', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
  expect(fake.console.tags.byTagId.delete).toHaveBeenCalledExactlyOnceWith({
    params: { tag_id: frontendId },
  })
  await expect
    .element(page.getByRole('region', { name: 'Notifications' }).getByRole('dialog'))
    .not.toBeInTheDocument()
})

it('keeps a pending deletion single-submission and removes the tag only after completion', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const pending = hold(fake.console.tags.byTagId.delete)
    await renderEditor('0')
    await remove().click()
    await vi.advanceTimersByTimeAsync(200)
    await expect.poll(() => fake.console.tags.byTagId.delete).toHaveBeenCalledOnce()
    await expect.element(page.getByText('Frontend', { exact: true })).toBeVisible()
    await remove().click()
    await vi.advanceTimersByTimeAsync(200)
    expect(fake.console.tags.byTagId.delete).toHaveBeenCalledOnce()
    pending.release()
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
  expect(fake.console.tags.byTagId.delete).not.toHaveBeenCalled()
  await remove().click()
  await confirmation().getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(confirmation()).not.toBeInTheDocument()
  await expect.element(page.getByText('Frontend', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
})

it('shows a deletion error and keeps both tags available', async () => {
  fake.console.tags.byTagId.delete.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Delete failed' }),
  )
  await renderEditor('0')
  await remove().click()
  await expect.element(page.getByText('Delete failed', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Frontend', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Backend', { exact: true })).toBeVisible()
})

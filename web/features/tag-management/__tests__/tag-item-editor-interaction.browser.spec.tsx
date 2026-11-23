import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { TagItemEditor } from '../tag-item-editor'

// Console routes validate the tag id path param as a UUID.
const TAG_ID = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b'

const fake = setupFakeApi({
  console: {
    tags: {
      byTagId: {
        patch: () => {
          throw apiError({ status: 400, message: 'Tag name already exists' })
        },
      },
    },
  },
})

afterEach(() => {
  toast.dismiss()
})

it('shows one business error per failed rename, including a retry through the real transport', async () => {
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  await render(
    <Wrapper>
      <TagItemEditor tag={{ id: TAG_ID, name: 'Original', type: 'app', binding_count: '0' }} />
      <AppToaster />
    </Wrapper>,
  )

  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.getByRole('button', { name: 'common.operation.edit Original' }).click()
    await page.getByRole('textbox', { name: 'common.operation.rename Original' }).fill('Renamed')
    await userEvent.tab()
    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
    await expect.element(page.getByText('Tag name already exists', { exact: true })).toBeVisible()
    await page.getByRole('dialog', { name: 'Tag name already exists' }).hover()
    // A second transport notification would expose a second independently dismissible card.
    await expect.element(page.getByRole('button', { name: 'Close notification' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Close notification' }).all()).toHaveLength(1)
    expect(fake.console.tags.byTagId.patch).toHaveBeenCalledTimes(attempt)
    expect(fake.console.tags.byTagId.patch).toHaveBeenLastCalledWith({
      params: { tag_id: TAG_ID },
      body: { name: 'Renamed' },
    })
    await page.getByRole('button', { name: 'Close notification' }).click()
    await expect
      .element(page.getByText('Tag name already exists', { exact: true }))
      .not.toBeInTheDocument()
  }
})

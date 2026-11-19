import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { TagItemEditor } from '../tag-item-editor'

afterEach(() => {
  vi.restoreAllMocks()
  toast.dismiss()
})

it('shows one business error per failed rename, including a retry through the real transport', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(String(input))
    if (!request.url.endsWith('/tags/tag-1') || request.method !== 'PATCH')
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    return Response.json({ message: 'Tag name already exists' }, { status: 400 })
  })
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  await render(
    <Wrapper>
      <TagItemEditor tag={{ id: 'tag-1', name: 'Original', type: 'app', binding_count: '0' }} />
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
    expect(network).toHaveBeenCalledTimes(attempt)
    await page.getByRole('button', { name: 'Close notification' }).click()
    await expect
      .element(page.getByText('Tag name already exists', { exact: true }))
      .not.toBeInTheDocument()
  }
})

import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import FilePreview from '../file-preview'

const { preview } = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.byFileId.preview.get': preview,
    }),
  }
})

it('loads the selected file content and dismisses its preview', async () => {
  const user = userEvent.setup()
  const response = { content: 'file content here with some text' }
  const pending = createDeferred<typeof response>()
  preview.mockReturnValue(pending.promise)
  const hidePreview = vi.fn()
  const file = Object.assign(new File(['content'], 'document.pdf'), {
    id: 'file-1',
    extension: 'pdf',
  })
  render(<FilePreview file={file} hidePreview={hidePreview} />)
  expect(screen.getByText('document.pdf')).toBeInTheDocument()
  expect(screen.queryByText(response.content)).not.toBeInTheDocument()
  await act(async () => pending.resolve(response))
  expect(await screen.findByText(response.content)).toBeInTheDocument()
  expect(preview).toHaveBeenCalledWith({ params: { file_id: 'file-1' } })
  await user.click(screen.getByRole('button'))
  expect(hidePreview).toHaveBeenCalledOnce()
})

import type { FileEntity } from '../../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { mockFixtureImageFetch } from '@/test/image-fetch'
import ImageUploader from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': async () => ({
        image_file_batch_limit: 10,
        single_chunk_attachment_limit: 20,
        attachment_image_file_size_limit: 15,
      }),
    }),
  }
})
const files: FileEntity[] = ['first.png', 'second.png'].map((name, index) => ({
  id: `file-${index}`,
  name,
  extension: 'png',
  mimeType: 'image/png',
  progress: 100,
  uploadedId: `upload-${index}`,
  size: 1,
  base64Url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
}))

it('opens the selected attachment and removes it without activating preview', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <ImageUploader
      value={files}
      onChange={onChange}
      textArea={<textarea aria-label="Query" />}
      actionButton={<button>Search</button>}
    />,
  )
  await user.click(screen.getAllByRole('img', { name: 'Preview' })[1]!)
  const preview = await screen.findByRole('dialog', { name: 'second.png' })
  await user.click(within(preview).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
  expect(onChange).toHaveBeenLastCalledWith([files[0]])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('hides image controls for text-only retrieval while leaving the query and action available', () => {
  render(
    <ImageUploader
      value={files}
      onChange={vi.fn()}
      showUploader={false}
      textArea={<textarea aria-label="Query" />}
      actionButton={<button>Search</button>}
    />,
  )
  expect(screen.getByRole('textbox', { name: 'Query' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: 'Preview' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
  expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument()
})

beforeEach(() => mockFixtureImageFetch())

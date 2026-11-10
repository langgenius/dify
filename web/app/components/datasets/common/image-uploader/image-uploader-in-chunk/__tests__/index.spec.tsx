import type { FileEntity } from '../../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { mockFixtureImageFetch } from '@/test/image-fetch'
import ImageUploaderInChunk from '../index'

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
  render(<ImageUploaderInChunk value={files} onChange={onChange} />)
  await user.click(screen.getAllByRole('img', { name: 'Preview' })[1]!)
  const preview = await screen.findByRole('dialog', { name: 'second.png' })
  await user.click(within(preview).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
  expect(onChange).toHaveBeenLastCalledWith([files[0]])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps attachment previews available when uploading and removal are disabled', async () => {
  const user = userEvent.setup()
  render(<ImageUploaderInChunk value={files} onChange={vi.fn()} disabled />)
  expect(screen.queryByText('dataset.imageUploader.browse')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('img', { name: 'Preview' })[0]!)
  expect(await screen.findByRole('dialog', { name: 'first.png' })).toBeInTheDocument()
})

beforeEach(() => mockFixtureImageFetch())

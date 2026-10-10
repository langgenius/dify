import type { FileEntity } from '../../types'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageUploaderInRetrievalTesting } from '../index'

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: {
      image_file_batch_limit: 10,
      single_chunk_attachment_limit: 20,
      attachment_image_file_size_limit: 15,
    },
  }),
}))

const fetchImage = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchImage.mockImplementation(
    async () => new Response(new Blob(['image'], { type: 'image/png' })),
  )
  vi.stubGlobal('fetch', fetchImage)
  vi.stubGlobal(
    'Image',
    class {
      constructor() {
        const image = document.createElement('img')
        Object.defineProperties(image, {
          naturalWidth: { value: 80 },
          naturalHeight: { value: 60 },
        })
        queueMicrotask(() => image.dispatchEvent(new Event('load')))
        return image
      }
    },
  )
  let resourceId = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++resourceId}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const files: FileEntity[] = [
  {
    id: 'pending',
    name: 'Pending',
    progress: 0,
    size: 10,
    extension: 'png',
    mimeType: 'image/png',
  },
  {
    id: 'one',
    name: 'Local.png',
    progress: 50,
    base64Url: 'data:image/png;base64,local',
    sourceUrl: 'https://example.com/remote.png',
    size: 10,
    extension: 'png',
    mimeType: 'image/png',
  },
  {
    id: 'two',
    name: 'Remote.png',
    progress: 100,
    uploadedId: 'uploaded',
    sourceUrl: 'https://example.com/two.png',
    size: 20,
    extension: 'png',
    mimeType: 'image/png',
  },
]

it('previews the clicked ready file and navigates only files with a source without writing upload state', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <ImageUploaderInRetrievalTesting
      textArea={<textarea aria-label="Query" />}
      actionButton={<button type="button">Search</button>}
      value={files}
      onChange={onChange}
    />,
  )
  expect(screen.getByRole('button', { name: 'Pending' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Remote.png' }))
  const remote = screen.getByRole('dialog', { name: 'Remote.png' })
  expect(await within(remote).findByRole('img', { name: 'Remote.png' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
  expect(fetchImage).toHaveBeenCalledWith(files[2]!.sourceUrl)
  await user.click(within(remote).getByRole('button', { name: 'common.pagination.previous' }))
  const local = screen.getByRole('dialog', { name: 'Local.png' })
  expect(await within(local).findByRole('img', { name: 'Local.png' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
  expect(fetchImage).toHaveBeenCalledWith(files[1]!.base64Url)
  expect(fetchImage).not.toHaveBeenCalledWith(files[1]!.sourceUrl)
  expect(within(local).getByRole('button', { name: 'common.pagination.previous' })).toBeDisabled()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onChange).not.toHaveBeenCalled()
})

it('removes files through the existing upload owner without opening a preview', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <ImageUploaderInRetrievalTesting
      textArea={<textarea aria-label="Query" />}
      actionButton={<button type="button">Search</button>}
      value={[files[2]!]}
      onChange={onChange}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onChange).toHaveBeenCalledWith([])
  expect(screen.queryByRole('button', { name: 'Remote.png' })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('hides uploader entries without hiding query and search controls', () => {
  render(
    <ImageUploaderInRetrievalTesting
      showUploader={false}
      textArea={<textarea aria-label="Query" />}
      actionButton={<button type="button">Search</button>}
      value={files}
      onChange={vi.fn()}
    />,
  )
  expect(screen.getByRole('textbox', { name: 'Query' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Local.png' })).not.toBeInTheDocument()
})

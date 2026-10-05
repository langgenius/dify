import type { FileEntity } from '../../types'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImagePreviewer } from '../../../image-previewer'
import { ImageItem } from '../image-item'

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

const file: FileEntity = {
  id: 'one',
  name: 'local.png',
  progress: 50,
  base64Url: 'data:image/png;base64,local',
  sourceUrl: 'https://example.com/remote.png',
  size: 10,
  extension: 'png',
  mimeType: 'image/png',
}

function Fixture({ progress = 50, disabled = false, onRemove = vi.fn(), onReUpload = vi.fn() }) {
  return (
    <ImagePreviewer>
      <ImageItem
        file={{ ...file, progress }}
        showDeleteAction
        disabled={disabled}
        onRemove={onRemove}
        onReUpload={onReUpload}
        previewPayload={{
          images: [{ name: file.name, url: file.base64Url!, size: file.size }],
          initialIndex: 0,
        }}
      />
    </ImagePreviewer>
  )
}

it('previews local images during upload by keyboard and returns to the same entry', async () => {
  const user = userEvent.setup()
  render(<Fixture />)
  const trigger = screen.getByRole('button', { name: file.name })
  trigger.focus()
  await user.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: file.name })
  expect(await within(dialog).findByRole('img', { name: file.name })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
  expect(fetchImage).toHaveBeenCalledWith(file.base64Url)
  expect(fetchImage).not.toHaveBeenCalledWith(file.sourceUrl)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

it('keeps removal and retry separate from the preview action', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn()
  const onReUpload = vi.fn()
  render(<Fixture progress={-1} onRemove={onRemove} onReUpload={onReUpload} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onRemove).toHaveBeenCalledWith('one')
  screen.getByRole('button', { name: 'common.operation.retry' }).focus()
  await user.keyboard('{Enter}')
  expect(onReUpload).toHaveBeenCalledWith('one')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('blocks mutations when disabled while retaining read-only preview', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn()
  const onReUpload = vi.fn()
  render(<Fixture progress={-1} disabled onRemove={onRemove} onReUpload={onReUpload} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onRemove).not.toHaveBeenCalled()
  expect(onReUpload).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: file.name }))
  expect(screen.getByRole('dialog', { name: file.name })).toBeInTheDocument()
})

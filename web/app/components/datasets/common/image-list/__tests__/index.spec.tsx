import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageList } from '../index'

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

const images = [1, 2, 3].map((index) => ({
  name: `image-${index}.png`,
  mimeType: 'image/png',
  sourceUrl: `https://example.com/${index}.png`,
  size: 1024,
  extension: 'png',
}))

it('opens the clicked image, navigates the visible list, and returns focus without card bubbling', async () => {
  const user = userEvent.setup()
  const onCardClick = vi.fn()
  render(
    <div role="presentation" onClick={onCardClick}>
      <ImageList images={images} size="md" limit={2} />
    </div>,
  )
  const trigger = screen.getByRole('button', { name: 'image-2.png' })
  await user.click(trigger)
  let dialog = screen.getByRole('dialog', { name: 'image-2.png' })
  expect(await within(dialog).findByRole('img', { name: 'image-2.png' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
  expect(fetchImage).toHaveBeenCalledWith(images[1]!.sourceUrl)
  expect(within(dialog).getByRole('button', { name: 'common.pagination.next' })).toBeDisabled()
  await user.click(within(dialog).getByRole('button', { name: 'common.pagination.previous' }))
  dialog = screen.getByRole('dialog', { name: 'image-1.png' })
  expect(await within(dialog).findByRole('img', { name: 'image-1.png' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
  expect(fetchImage).toHaveBeenCalledWith(images[0]!.sourceUrl)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
  expect(onCardClick).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '+1' }))
  await user.click(screen.getByRole('button', { name: 'image-3.png' }))
  expect(screen.getByRole('dialog', { name: 'image-3.png' })).toBeInTheDocument()
  expect(onCardClick).not.toHaveBeenCalled()
})

it('keeps galleries independent and disabled placeholders outside navigation', async () => {
  const user = userEvent.setup()
  render(
    <>
      <ImageList
        images={[{ ...images[0]!, name: 'Pending', sourceUrl: '' }, images[1]!]}
        size="md"
      />
      <ImageList images={[images[2]!]} size="md" />
    </>,
  )
  const pending = screen.getByRole('button', { name: 'Pending' })
  expect(pending).toBeDisabled()
  expect(within(pending).getByRole('img')).not.toHaveAttribute('src')
  await user.click(screen.getByRole('button', { name: 'image-2.png' }))
  const dialog = screen.getByRole('dialog', { name: 'image-2.png' })
  expect(within(dialog).getByRole('button', { name: 'common.pagination.previous' })).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: 'common.pagination.next' })).toBeDisabled()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'image-3.png' }))
  expect(screen.getByRole('dialog', { name: 'image-3.png' })).toBeInTheDocument()
})

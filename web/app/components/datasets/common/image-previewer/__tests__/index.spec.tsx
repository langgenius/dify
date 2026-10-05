import type { ImageInfo } from '../index'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImagePreviewer } from '../index'

const images: ImageInfo[] = [
  { url: 'https://example.com/image1.png', name: 'image1.png', size: 1024 },
  { url: 'https://example.com/image2.png', name: 'image2.png', size: 2048 },
  { url: 'https://example.com/image3.png', name: 'image3.png', size: 3072 },
]

function Gallery({ items = images }: { items?: readonly ImageInfo[] }) {
  return (
    <ImagePreviewer>
      {items.map((image, initialIndex) => (
        <DialogTrigger key={image.url} payload={{ images: items, initialIndex }}>
          Preview {image.name || 'unnamed image'}
        </DialogTrigger>
      ))}
    </ImagePreviewer>
  )
}

const fetchImage = vi.fn<typeof fetch>()
let decoders: HTMLImageElement[] = []
let createdUrls: string[] = []

beforeEach(() => {
  decoders = []
  createdUrls = []
  fetchImage.mockImplementation(
    async () => new Response(new Blob(['image'], { type: 'image/png' })),
  )
  vi.stubGlobal('fetch', fetchImage)
  vi.stubGlobal(
    'Image',
    class {
      constructor() {
        const image = document.createElement('img')
        decoders.push(image)
        return image
      }
    },
  )
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:preview-${createdUrls.length + 1}`
    createdUrls.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function finishImageLoad(index: number, width = 800, height = 600) {
  await waitFor(() => expect(decoders[index]).toBeDefined())
  const image = decoders[index]!
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  })
  fireEvent.load(image)
}

const getNavigation = (dialog: HTMLElement) => ({
  previous: within(dialog).getByRole('button', { name: 'common.pagination.previous' }),
  next: within(dialog).getByRole('button', { name: 'common.pagination.next' }),
})

describe('ImagePreviewer', () => {
  it('preloads the full gallery and reuses loaded images when navigating', async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    expect(fetchImage).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Preview image2.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'image2.png' })
    expect(within(dialog).getByRole('progressbar')).toBeInTheDocument()
    await waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(3))
    images.forEach(({ url }) => expect(fetchImage).toHaveBeenCalledWith(url))
    await finishImageLoad(0)
    await finishImageLoad(1)
    await finishImageLoad(2)
    expect(within(dialog).getByRole('img', { name: 'image2.png' })).toHaveAttribute(
      'src',
      createdUrls[1],
    )
    expect(within(dialog).getByText(/800.*600/)).toBeInTheDocument()
    expect(within(dialog).getByText('2.00 KB')).toBeInTheDocument()
    await user.click(getNavigation(dialog).next)
    expect(within(dialog).getByRole('img', { name: 'image3.png' })).toHaveAttribute(
      'src',
      createdUrls[2],
    )
    await user.click(getNavigation(dialog).previous)
    expect(within(dialog).getByRole('img', { name: 'image2.png' })).toHaveAttribute(
      'src',
      createdUrls[1],
    )
    expect(fetchImage).toHaveBeenCalledTimes(3)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3)
  })

  it.each(['request', 'decode'])(
    'retries a failed %s without fetching cached siblings again',
    async (failure) => {
      const user = userEvent.setup()
      if (failure === 'request')
        fetchImage.mockResolvedValueOnce(new Response(null, { status: 503 }))
      render(<Gallery />)
      await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
      const dialog = await screen.findByRole('dialog', { name: 'image1.png' })
      if (failure === 'decode') {
        await waitFor(() => expect(decoders).toHaveLength(3))
        fireEvent.error(decoders[0]!)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(createdUrls[0])
      }
      await within(dialog).findByText('common.imageUploader.uploadFromComputerReadError')
      const decoderIndex = decoders.length
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.retry' }))
      expect(within(dialog).getByRole('progressbar')).toBeInTheDocument()
      await finishImageLoad(decoderIndex, 320, 240)
      expect(fetchImage).toHaveBeenCalledTimes(4)
      expect(fetchImage).toHaveBeenLastCalledWith(images[0]?.url)
      expect(within(dialog).getByText(/320.*240/)).toBeInTheDocument()
      expect(
        within(dialog).queryByRole('button', { name: 'common.operation.retry' }),
      ).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(createdUrls.length)
    },
  )

  it('loads a local data image and keeps a localized name for an unnamed image', async () => {
    const user = userEvent.setup()
    const url = 'data:image/png;base64,iVBORw0KGgo='
    render(<Gallery items={[{ url, name: '', size: 50 }]} />)
    await user.click(screen.getByRole('button', { name: 'Preview unnamed image' }))
    const dialog = await screen.findByRole('dialog', { name: 'workflow.common.preview' })
    await finishImageLoad(0)
    expect(fetchImage).toHaveBeenCalledWith(url)
    expect(within(dialog).getByAltText('')).toHaveAttribute('src', createdUrls[0])
    const { previous, next } = getNavigation(dialog)
    expect(previous).toBeDisabled()
    expect(next).toBeDisabled()
  })

  it('navigates the session with buttons and one step per held arrow', async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'image1.png' })
    const { previous, next } = getNavigation(dialog)
    expect(previous).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
    await user.keyboard('{ArrowRight>3/}')
    expect(dialog).toHaveAccessibleName('image2.png')
    await user.keyboard('{ArrowRight}')
    expect(dialog).toHaveAccessibleName('image3.png')
    expect(next).toBeDisabled()
    await user.keyboard('{ArrowRight>3/}')
    expect(dialog).toHaveAccessibleName('image3.png')
    await user.keyboard('{ArrowLeft}')
    expect(dialog).toHaveAccessibleName('image2.png')
    await user.click(previous)
    expect(dialog).toHaveAccessibleName('image1.png')
    expect(previous).toBeDisabled()
    await user.click(next)
    expect(dialog).toHaveAccessibleName('image2.png')
  })

  it('keeps the opened image list when an active trigger receives a shorter live payload', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Gallery />)
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'image1.png' })
    await user.click(getNavigation(dialog).next)
    await user.click(getNavigation(dialog).next)
    expect(dialog).toHaveAccessibleName('image3.png')
    rerender(<Gallery items={images.slice(0, 1)} />)
    expect(dialog).toHaveAccessibleName('image3.png')
    await user.click(getNavigation(dialog).previous)
    expect(dialog).toHaveAccessibleName('image2.png')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const reopened = await screen.findByRole('dialog', { name: 'image1.png' })
    expect(getNavigation(reopened).next).toBeDisabled()
  })

  it('does not dismiss from content clicks and restores the actual trigger', async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    const trigger = screen.getByRole('button', { name: 'Preview image2.png' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'image2.png' })
    await user.click(dialog)
    expect(dialog).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'image2.png' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps independent galleries separate when one is closed', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Gallery items={images.slice(0, 1)} />
        <Gallery items={images.slice(1, 2)} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const first = await screen.findByRole('dialog', { name: 'image1.png' })
    await finishImageLoad(0)
    await user.click(within(first).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Preview image2.png' }))
    const second = await screen.findByRole('dialog', { name: 'image2.png' })
    await finishImageLoad(1, 640, 480)
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(createdUrls[0])
    expect(within(second).getByText(/640.*480/)).toBeInTheDocument()
    expect(within(second).getByRole('img', { name: 'image2.png' })).toHaveAttribute(
      'src',
      createdUrls[1],
    )
  })

  it('releases unfinished decodes on exit and ignores their late results after reopening', async () => {
    const user = userEvent.setup()
    render(<Gallery items={images.slice(0, 1)} />)
    const trigger = screen.getByRole('button', { name: 'Preview image1.png' })
    await user.click(trigger)
    const first = await screen.findByRole('dialog', { name: 'image1.png' })
    await waitFor(() => expect(decoders).toHaveLength(1))
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    await user.click(within(first).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(createdUrls[0])
    await user.click(trigger)
    const reopened = await screen.findByRole('dialog', { name: 'image1.png' })
    await finishImageLoad(0, 100, 100)
    expect(within(reopened).getByRole('progressbar')).toBeInTheDocument()
    fireEvent.error(decoders[0]!)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    await finishImageLoad(1, 640, 480)
    expect(within(reopened).getByRole('img', { name: 'image1.png' })).toHaveAttribute(
      'src',
      createdUrls[1],
    )
    expect(within(reopened).getByText(/640.*480/)).toBeInTheDocument()
    expect(fetchImage).toHaveBeenCalledTimes(2)
  })

  it.each(['response', 'blob'])(
    'does not create an object URL when a late %s arrives after exit',
    async (stage) => {
      const user = userEvent.setup()
      let finish!: () => void
      const pending = new Promise<void>((resolve) => {
        finish = resolve
      })
      const response = new Response(new Blob(['image']))
      if (stage === 'response')
        fetchImage.mockImplementationOnce(async () => {
          await pending
          return response
        })
      else {
        vi.spyOn(response, 'blob').mockImplementationOnce(async () => {
          await pending
          return new Blob(['image'])
        })
        fetchImage.mockResolvedValueOnce(response)
      }
      render(<Gallery items={images.slice(0, 1)} />)
      await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
      const dialog = await screen.findByRole('dialog', { name: 'image1.png' })
      if (stage === 'blob') await waitFor(() => expect(response.blob).toHaveBeenCalled())
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await act(async () => {
        finish()
        await pending
      })
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    },
  )
})

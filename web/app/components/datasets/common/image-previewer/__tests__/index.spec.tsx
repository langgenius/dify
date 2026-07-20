import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImagePreviewer from '../index'

const mockFetch = vi.fn<typeof fetch>()
const mockRevokeObjectURL = vi.fn()
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url')

class MockImage {
  naturalWidth = 800
  naturalHeight = 600
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private source = ''

  get src() {
    return this.source
  }

  set src(value: string) {
    this.source = value
    queueMicrotask(() => this.onload?.())
  }
}

const images = [
  { url: 'https://example.com/image1.png', name: 'image1.png', size: 1024 },
  { url: 'https://example.com/image2.png', name: 'image2.png', size: 2048 },
  { url: 'https://example.com/image3.png', name: 'image3.png', size: 3072 },
]

const successfulResponse = () => new Response(new Blob(['test'], { type: 'image/png' }))

const getPreviewButtons = () => {
  const [closeButton, previousButton, nextButton] = screen.getAllByRole('button')

  expect(closeButton).toBeInTheDocument()
  expect(previousButton).toBeInTheDocument()
  expect(nextButton).toBeInTheDocument()

  return { closeButton: closeButton!, previousButton: previousButton!, nextButton: nextButton! }
}

describe('ImagePreviewer', () => {
  beforeEach(() => {
    mockFetch.mockReset().mockImplementation(async () => successfulResponse())
    mockCreateObjectURL.mockClear()
    mockRevokeObjectURL.mockClear()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('Image', MockImage)
    vi.spyOn(URL, 'createObjectURL').mockImplementation(mockCreateObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mockRevokeObjectURL)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the preview and loading state while images are loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}))

    render(<ImagePreviewer images={images} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Esc')).toBeInTheDocument()
  })

  it('loads every image and displays the first image metadata by default', async () => {
    render(<ImagePreviewer images={images} onClose={vi.fn()} />)

    expect(await screen.findByRole('img', { name: 'image1.png' })).toHaveAttribute(
      'src',
      'blob:mock-url',
    )
    expect(screen.getByText(/800.*600/)).toBeInTheDocument()
    expect(screen.getByText('1.00 KB')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(images.map(({ url }) => url))
  })

  it('starts from the requested image', async () => {
    render(<ImagePreviewer images={images} initialIndex={1} onClose={vi.fn()} />)

    expect(await screen.findByRole('img', { name: 'image2.png' })).toBeInTheDocument()
  })

  it('navigates between images and disables navigation at the boundaries', async () => {
    const user = userEvent.setup()
    render(<ImagePreviewer images={images} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: 'image1.png' })
    const { previousButton, nextButton } = getPreviewButtons()

    expect(previousButton).toBeDisabled()
    expect(nextButton).toBeEnabled()

    await user.click(nextButton)
    expect(screen.getByRole('img', { name: 'image2.png' })).toBeInTheDocument()
    expect(previousButton).toBeEnabled()

    await user.click(nextButton)
    expect(screen.getByRole('img', { name: 'image3.png' })).toBeInTheDocument()
    expect(nextButton).toBeDisabled()

    await user.click(previousButton)
    expect(screen.getByRole('img', { name: 'image2.png' })).toBeInTheDocument()
  })

  it('disables both navigation buttons for a single image', async () => {
    render(<ImagePreviewer images={[images[0]!]} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: 'image1.png' })
    const { previousButton, nextButton } = getPreviewButtons()

    expect(previousButton).toBeDisabled()
    expect(nextButton).toBeDisabled()
  })

  it('keeps the preview open on content clicks and closes from the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImagePreviewer images={images} onClose={onClose} />)
    await screen.findByRole('img', { name: 'image1.png' })
    const { closeButton } = getPreviewButtons()

    await user.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows an error and retries the failed image', async () => {
    const user = userEvent.setup()
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    render(<ImagePreviewer images={images} onClose={vi.fn()} />)

    expect(await screen.findByText(/Failed to load image/)).toHaveTextContent(images[0]!.url)
    const [, retryButton] = screen.getAllByRole('button')
    expect(retryButton).toBeInTheDocument()

    await user.click(retryButton!)

    expect(await screen.findByRole('img', { name: 'image1.png' })).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(mockFetch).toHaveBeenLastCalledWith(images[0]!.url)
  })

  it('revokes loaded blob URLs on unmount', async () => {
    const { unmount } = render(<ImagePreviewer images={images} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: 'image1.png' })

    unmount()

    await waitFor(() => expect(mockRevokeObjectURL).toHaveBeenCalledTimes(3))
  })
})

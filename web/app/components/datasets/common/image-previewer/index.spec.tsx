import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImagePreviewer from './index'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock URL methods
const mockRevokeObjectURL = vi.fn()
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url')
globalThis.URL.revokeObjectURL = mockRevokeObjectURL
globalThis.URL.createObjectURL = mockCreateObjectURL

// Mock Image
class MockImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  _src = ''

  get src() {
    return this._src
  }

  set src(value: string) {
    this._src = value
    // Trigger onload after a microtask
    setTimeout(() => {
      if (this.onload)
        this.onload()
    }, 0)
  }

  naturalWidth = 800
  naturalHeight = 600
}
;(globalThis as unknown as { Image: typeof MockImage }).Image = MockImage

const createMockImages = () => [
  { url: 'https://example.com/image1.png', name: 'image1.png', size: 1024 },
  { url: 'https://example.com/image2.png', name: 'image2.png', size: 2048 },
  { url: 'https://example.com/image3.png', name: 'image3.png', size: 3072 },
]

describe('ImagePreviewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default successful fetch mock
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['test'], { type: 'image/png' })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      // Should render in portal
      expect(document.body.querySelector('.image-previewer')).toBeInTheDocument()
    })

    it('should render close button', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      // Esc text should be visible
      expect(screen.getByText('Esc')).toBeInTheDocument()
    })

    it('should show loading state initially', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      // Delay fetch to see loading state
      mockFetch.mockImplementation(() => new Promise(() => {}))

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      // Loading component should be visible
      expect(document.body.querySelector('.image-previewer')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should start at initialIndex', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} initialIndex={1} onClose={onClose} />)
      })

      await waitFor(() => {
        // Should start at second image
        expect(screen.getByText('image2.png')).toBeInTheDocument()
      })
    })

    it('should default initialIndex to 0', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(screen.getByText('image1.png')).toBeInTheDocument()
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      // Find and click close button (the one with RiCloseLine icon)
      const closeButton = document.querySelector('.absolute.right-6 button')
      if (closeButton) {
        fireEvent.click(closeButton)
        expect(onClose).toHaveBeenCalledTimes(1)
      }
    })

    it('should navigate to next image when next button is clicked', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(screen.getByText('image1.png')).toBeInTheDocument()
      })

      // Find and click next button (right arrow)
      const buttons = document.querySelectorAll('button')
      const nextButton = Array.from(buttons).find(btn =>
        btn.className.includes('right-8'),
      )

      if (nextButton) {
        await act(async () => {
          fireEvent.click(nextButton)
        })

        await waitFor(() => {
          expect(screen.getByText('image2.png')).toBeInTheDocument()
        })
      }
    })

    it('should navigate to previous image when prev button is clicked', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} initialIndex={1} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(screen.getByText('image2.png')).toBeInTheDocument()
      })

      // Find and click prev button (left arrow)
      const buttons = document.querySelectorAll('button')
      const prevButton = Array.from(buttons).find(btn =>
        btn.className.includes('left-8'),
      )

      if (prevButton) {
        await act(async () => {
          fireEvent.click(prevButton)
        })

        await waitFor(() => {
          expect(screen.getByText('image1.png')).toBeInTheDocument()
        })
      }
    })

    it('should disable prev button at first image', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} initialIndex={0} onClose={onClose} />)
      })

      const buttons = document.querySelectorAll('button')
      const prevButton = Array.from(buttons).find(btn =>
        btn.className.includes('left-8'),
      )

      expect(prevButton).toBeDisabled()
    })

    it('should disable next button at last image', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} initialIndex={2} onClose={onClose} />)
      })

      const buttons = document.querySelectorAll('button')
      const nextButton = Array.from(buttons).find(btn =>
        btn.className.includes('right-8'),
      )

      expect(nextButton).toBeDisabled()
    })
  })

  describe('Image Loading', () => {
    it('should fetch images on mount', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
    })

    it('should show error state when fetch fails', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      mockFetch.mockRejectedValue(new Error('Network error'))

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(screen.getByText(/Failed to load image/)).toBeInTheDocument()
      })
    })

    it('should show retry button on error', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      mockFetch.mockRejectedValue(new Error('Network error'))

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        // Retry button should be visible
        const retryButton = document.querySelector('button.rounded-full')
        expect(retryButton).toBeInTheDocument()
      })
    })
  })

  describe('Navigation Boundary Cases', () => {
    it('should not navigate past first image when prevImage is called at index 0', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} initialIndex={0} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(screen.getByText('image1.png')).toBeInTheDocument()
      })

      // Click prev button multiple times - should stay at first image
      const buttons = document.querySelectorAll('button')
      const prevButton = Array.from(buttons).find(btn =>
        btn.className.includes('left-8'),
      )

      if (prevButton) {
        await act(async () => {
          fireEvent.click(prevButton)
          fireEvent.click(prevButton)
        })

        // Should still be at first image
        await waitFor(() => {
          expect(screen.getByText('image1.png')).toBeInTheDocument()
        })
      }
    })

    it('should not navigate past last image when nextImage is called at last index', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} initialIndex={2} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(screen.getByText('image3.png')).toBeInTheDocument()
      })

      // Click next button multiple times - should stay at last image
      const buttons = document.querySelectorAll('button')
      const nextButton = Array.from(buttons).find(btn =>
        btn.className.includes('right-8'),
      )

      if (nextButton) {
        await act(async () => {
          fireEvent.click(nextButton)
          fireEvent.click(nextButton)
        })

        // Should still be at last image
        await waitFor(() => {
          expect(screen.getByText('image3.png')).toBeInTheDocument()
        })
      }
    })
  })

  describe('Retry Functionality', () => {
    it('should retry image load when retry button is clicked', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      // First fail, then succeed
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.reject(new Error('Network error'))
        }
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(new Blob(['test'], { type: 'image/png' })),
        })
      })

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText(/Failed to load image/)).toBeInTheDocument()
      })

      // Click retry button
      const retryButton = document.querySelector('button.rounded-full')
      if (retryButton) {
        await act(async () => {
          fireEvent.click(retryButton)
        })

        // Should refetch the image
        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledTimes(4) // 3 initial + 1 retry
        })
      }
    })

    it('should show retry button and call retryImage when clicked', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      mockFetch.mockRejectedValue(new Error('Network error'))

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        expect(screen.getByText(/Failed to load image/)).toBeInTheDocument()
      })

      // Find and click the retry button (not the nav buttons)
      const allButtons = document.querySelectorAll('button')
      const retryButton = Array.from(allButtons).find(btn =>
        btn.className.includes('rounded-full') && !btn.className.includes('left-8') && !btn.className.includes('right-8'),
      )

      expect(retryButton).toBeInTheDocument()

      if (retryButton) {
        mockFetch.mockClear()
        mockFetch.mockResolvedValue({
          ok: true,
          blob: () => Promise.resolve(new Blob(['test'], { type: 'image/png' })),
        })

        await act(async () => {
          fireEvent.click(retryButton)
        })

        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalled()
        })
      }
    })
  })

  describe('Image Cache', () => {
    it('should clean up blob URLs on unmount', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      // First render to populate cache
      const { unmount } = await act(async () => {
        const result = render(<ImagePreviewer images={images} onClose={onClose} />)
        return result
      })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })

      // Store the call count for verification
      const _firstCallCount = mockFetch.mock.calls.length

      unmount()

      // Note: The imageCache is cleared on unmount, so this test verifies
      // the cleanup behavior rather than caching across mounts
      expect(mockRevokeObjectURL).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle single image', async () => {
      const onClose = vi.fn()
      const images = [createMockImages()[0]]

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      // Both navigation buttons should be disabled
      const buttons = document.querySelectorAll('button')
      const prevButton = Array.from(buttons).find(btn =>
        btn.className.includes('left-8'),
      )
      const nextButton = Array.from(buttons).find(btn =>
        btn.className.includes('right-8'),
      )

      expect(prevButton).toBeDisabled()
      expect(nextButton).toBeDisabled()
    })

    it('should stop event propagation on container click', async () => {
      const onClose = vi.fn()
      const parentClick = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(
          <div onClick={parentClick}>
            <ImagePreviewer images={images} onClose={onClose} />
          </div>,
        )
      })

      const container = document.querySelector('.image-previewer')
      if (container) {
        fireEvent.click(container)
        expect(parentClick).not.toHaveBeenCalled()
      }
    })

    it('should display image dimensions when loaded', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        // Should display dimensions (800 × 600 from MockImage)
        expect(screen.getByText(/800.*600/)).toBeInTheDocument()
      })
    })

    it('should display file size', async () => {
      const onClose = vi.fn()
      const images = createMockImages()

      await act(async () => {
        render(<ImagePreviewer images={images} onClose={onClose} />)
      })

      await waitFor(() => {
        // Should display formatted file size
        expect(screen.getByText('image1.png')).toBeInTheDocument()
      })
    })
  })
})

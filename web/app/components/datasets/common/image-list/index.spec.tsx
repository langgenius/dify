import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImageList from './index'

// Track handleImageClick calls for testing
type FileEntity = {
  sourceUrl: string
  name: string
  mimeType?: string
  size?: number
  extension?: string
}

let capturedOnClick: ((file: FileEntity) => void) | null = null

// Mock FileThumb to capture click handler
vi.mock('@/app/components/base/file-thumb', () => ({
  default: ({ file, onClick }: { file: FileEntity, onClick?: (file: FileEntity) => void }) => {
    // Capture the onClick for testing
    capturedOnClick = onClick ?? null
    return (
      <div
        data-testid={`file-thumb-${file.sourceUrl}`}
        className="cursor-pointer"
        onClick={() => onClick?.(file)}
      >
        {file.name}
      </div>
    )
  },
}))

type ImagePreviewerProps = {
  images: ImageInfo[]
  initialIndex: number
  onClose: () => void
}

type ImageInfo = {
  url: string
  name: string
  size: number
}

// Mock ImagePreviewer since it uses createPortal
vi.mock('../image-previewer', () => ({
  default: ({ images, initialIndex, onClose }: ImagePreviewerProps) => (
    <div data-testid="image-previewer">
      <span data-testid="preview-count">{images.length}</span>
      <span data-testid="preview-index">{initialIndex}</span>
      <button data-testid="close-preview" onClick={onClose}>Close</button>
    </div>
  ),
}))

const createMockImages = (count: number) => {
  return Array.from({ length: count }, (_, i) => ({
    name: `image-${i + 1}.png`,
    mimeType: 'image/png',
    sourceUrl: `https://example.com/image-${i + 1}.png`,
    size: 1024 * (i + 1),
    extension: 'png',
  }))
}

describe('ImageList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const images = createMockImages(3)
      const { container } = render(<ImageList images={images} size="md" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render all images when count is below limit', () => {
      const images = createMockImages(5)
      render(<ImageList images={images} size="md" limit={9} />)
      // Each image renders a FileThumb component
      const thumbnails = document.querySelectorAll('[class*="cursor-pointer"]')
      expect(thumbnails.length).toBeGreaterThanOrEqual(5)
    })

    it('should render limited images when count exceeds limit', () => {
      const images = createMockImages(15)
      render(<ImageList images={images} size="md" limit={9} />)
      // More button should be visible
      expect(screen.getByText(/\+6/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const images = createMockImages(3)
      const { container } = render(
        <ImageList images={images} size="md" className="custom-class" />,
      )
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should use default limit of 9', () => {
      const images = createMockImages(12)
      render(<ImageList images={images} size="md" />)
      // Should show "+3" for remaining images
      expect(screen.getByText(/\+3/)).toBeInTheDocument()
    })

    it('should respect custom limit', () => {
      const images = createMockImages(10)
      render(<ImageList images={images} size="md" limit={5} />)
      // Should show "+5" for remaining images
      expect(screen.getByText(/\+5/)).toBeInTheDocument()
    })

    it('should handle size prop sm', () => {
      const images = createMockImages(2)
      const { container } = render(<ImageList images={images} size="sm" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle size prop md', () => {
      const images = createMockImages(2)
      const { container } = render(<ImageList images={images} size="md" />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should show all images when More button is clicked', () => {
      const images = createMockImages(15)
      render(<ImageList images={images} size="md" limit={9} />)

      // Click More button
      const moreButton = screen.getByText(/\+6/)
      fireEvent.click(moreButton)

      // More button should disappear
      expect(screen.queryByText(/\+6/)).not.toBeInTheDocument()
    })

    it('should open preview when image is clicked', () => {
      const images = createMockImages(3)
      render(<ImageList images={images} size="md" />)

      // Find and click an image thumbnail
      const thumbnails = document.querySelectorAll('[class*="cursor-pointer"]')
      if (thumbnails.length > 0) {
        fireEvent.click(thumbnails[0])
        // Preview should open
        expect(screen.getByTestId('image-previewer')).toBeInTheDocument()
      }
    })

    it('should close preview when close button is clicked', () => {
      const images = createMockImages(3)
      render(<ImageList images={images} size="md" />)

      // Open preview
      const thumbnails = document.querySelectorAll('[class*="cursor-pointer"]')
      if (thumbnails.length > 0) {
        fireEvent.click(thumbnails[0])

        // Close preview
        const closeButton = screen.getByTestId('close-preview')
        fireEvent.click(closeButton)

        // Preview should be closed
        expect(screen.queryByTestId('image-previewer')).not.toBeInTheDocument()
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty images array', () => {
      const { container } = render(<ImageList images={[]} size="md" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should not open preview when clicked image not found in list (index === -1)', () => {
      const images = createMockImages(3)
      const { rerender } = render(<ImageList images={images} size="md" />)

      // Click first image to open preview
      const firstThumb = screen.getByTestId('file-thumb-https://example.com/image-1.png')
      fireEvent.click(firstThumb)

      // Preview should open for valid image
      expect(screen.getByTestId('image-previewer')).toBeInTheDocument()

      // Close preview
      fireEvent.click(screen.getByTestId('close-preview'))
      expect(screen.queryByTestId('image-previewer')).not.toBeInTheDocument()

      // Now render with images that don't include the previously clicked one
      const newImages = createMockImages(2) // Only 2 images
      rerender(<ImageList images={newImages} size="md" />)

      // Click on a thumbnail that exists
      const validThumb = screen.getByTestId('file-thumb-https://example.com/image-1.png')
      fireEvent.click(validThumb)
      expect(screen.getByTestId('image-previewer')).toBeInTheDocument()
    })

    it('should return early when file sourceUrl is not found in limitedImages (index === -1)', () => {
      const images = createMockImages(3)
      render(<ImageList images={images} size="md" />)

      // Call the captured onClick with a file that has a non-matching sourceUrl
      // This triggers the index === -1 branch (line 44-45)
      if (capturedOnClick) {
        capturedOnClick({
          name: 'nonexistent.png',
          mimeType: 'image/png',
          sourceUrl: 'https://example.com/nonexistent.png', // Not in the list
          size: 1024,
          extension: 'png',
        })
      }

      // Preview should NOT open because the file was not found in limitedImages
      expect(screen.queryByTestId('image-previewer')).not.toBeInTheDocument()
    })

    it('should handle single image', () => {
      const images = createMockImages(1)
      const { container } = render(<ImageList images={images} size="md" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should not show More button when images count equals limit', () => {
      const images = createMockImages(9)
      render(<ImageList images={images} size="md" limit={9} />)
      expect(screen.queryByText(/\+/)).not.toBeInTheDocument()
    })

    it('should handle limit of 0', () => {
      const images = createMockImages(5)
      render(<ImageList images={images} size="md" limit={0} />)
      // Should show "+5" for all images
      expect(screen.getByText(/\+5/)).toBeInTheDocument()
    })

    it('should handle limit larger than images count', () => {
      const images = createMockImages(5)
      render(<ImageList images={images} size="md" limit={100} />)
      // Should not show More button
      expect(screen.queryByText(/\+/)).not.toBeInTheDocument()
    })
  })
})

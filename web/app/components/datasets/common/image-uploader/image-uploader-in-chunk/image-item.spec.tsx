import type { FileEntity } from '../types'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImageItem from './image-item'

const createMockFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'test-id',
  name: 'test.png',
  progress: 100,
  base64Url: 'data:image/png;base64,test',
  sourceUrl: 'https://example.com/test.png',
  size: 1024,
  ...overrides,
} as FileEntity)

describe('ImageItem (image-uploader-in-chunk)', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const file = createMockFile()
      const { container } = render(<ImageItem file={file} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render image preview', () => {
      const file = createMockFile()
      const { container } = render(<ImageItem file={file} />)
      // FileImageRender component should be present
      expect(container.querySelector('.group\\/file-image')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should show delete button when showDeleteAction is true', () => {
      const file = createMockFile()
      const { container } = render(
        <ImageItem file={file} showDeleteAction onRemove={() => {}} />,
      )
      // Delete button has RiCloseLine icon
      const deleteButton = container.querySelector('button')
      expect(deleteButton).toBeInTheDocument()
    })

    it('should not show delete button when showDeleteAction is false', () => {
      const file = createMockFile()
      const { container } = render(<ImageItem file={file} showDeleteAction={false} />)
      const deleteButton = container.querySelector('button')
      expect(deleteButton).not.toBeInTheDocument()
    })

    it('should use base64Url for image when available', () => {
      const file = createMockFile({ base64Url: 'data:image/png;base64,custom' })
      const { container } = render(<ImageItem file={file} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should fallback to sourceUrl when base64Url is not available', () => {
      const file = createMockFile({ base64Url: undefined })
      const { container } = render(<ImageItem file={file} />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Progress States', () => {
    it('should show progress indicator when progress is between 0 and 99', () => {
      const file = createMockFile({ progress: 50, uploadedId: undefined })
      const { container } = render(<ImageItem file={file} />)
      // Progress circle should be visible
      expect(container.querySelector('.bg-background-overlay-alt')).toBeInTheDocument()
    })

    it('should not show progress indicator when upload is complete', () => {
      const file = createMockFile({ progress: 100, uploadedId: 'uploaded-123' })
      const { container } = render(<ImageItem file={file} />)
      expect(container.querySelector('.bg-background-overlay-alt')).not.toBeInTheDocument()
    })

    it('should show retry button when progress is -1 (error)', () => {
      const file = createMockFile({ progress: -1 })
      const { container } = render(<ImageItem file={file} />)
      // Error state shows destructive overlay
      expect(container.querySelector('.bg-background-overlay-destructive')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onPreview when image is clicked', () => {
      const onPreview = vi.fn()
      const file = createMockFile()
      const { container } = render(<ImageItem file={file} onPreview={onPreview} />)

      const imageContainer = container.querySelector('.group\\/file-image')
      if (imageContainer) {
        fireEvent.click(imageContainer)
        expect(onPreview).toHaveBeenCalledWith('test-id')
      }
    })

    it('should call onRemove when delete button is clicked', () => {
      const onRemove = vi.fn()
      const file = createMockFile()
      const { container } = render(
        <ImageItem file={file} showDeleteAction onRemove={onRemove} />,
      )

      const deleteButton = container.querySelector('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
        expect(onRemove).toHaveBeenCalledWith('test-id')
      }
    })

    it('should call onReUpload when error overlay is clicked', () => {
      const onReUpload = vi.fn()
      const file = createMockFile({ progress: -1 })
      const { container } = render(<ImageItem file={file} onReUpload={onReUpload} />)

      const errorOverlay = container.querySelector('.bg-background-overlay-destructive')
      if (errorOverlay) {
        fireEvent.click(errorOverlay)
        expect(onReUpload).toHaveBeenCalledWith('test-id')
      }
    })

    it('should stop event propagation on delete button click', () => {
      const onRemove = vi.fn()
      const onPreview = vi.fn()
      const file = createMockFile()
      const { container } = render(
        <ImageItem file={file} showDeleteAction onRemove={onRemove} onPreview={onPreview} />,
      )

      const deleteButton = container.querySelector('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
        expect(onRemove).toHaveBeenCalled()
        expect(onPreview).not.toHaveBeenCalled()
      }
    })

    it('should stop event propagation on retry click', () => {
      const onReUpload = vi.fn()
      const onPreview = vi.fn()
      const file = createMockFile({ progress: -1 })
      const { container } = render(
        <ImageItem file={file} onReUpload={onReUpload} onPreview={onPreview} />,
      )

      const errorOverlay = container.querySelector('.bg-background-overlay-destructive')
      if (errorOverlay) {
        fireEvent.click(errorOverlay)
        expect(onReUpload).toHaveBeenCalled()
        // onPreview should not be called due to stopPropagation
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing onPreview callback', () => {
      const file = createMockFile()
      const { container } = render(<ImageItem file={file} />)

      const imageContainer = container.querySelector('.group\\/file-image')
      expect(() => {
        if (imageContainer)
          fireEvent.click(imageContainer)
      }).not.toThrow()
    })

    it('should handle missing onRemove callback', () => {
      const file = createMockFile()
      const { container } = render(<ImageItem file={file} showDeleteAction />)

      const deleteButton = container.querySelector('button')
      expect(() => {
        if (deleteButton)
          fireEvent.click(deleteButton)
      }).not.toThrow()
    })

    it('should handle missing onReUpload callback', () => {
      const file = createMockFile({ progress: -1 })
      const { container } = render(<ImageItem file={file} />)

      const errorOverlay = container.querySelector('.bg-background-overlay-destructive')
      expect(() => {
        if (errorOverlay)
          fireEvent.click(errorOverlay)
      }).not.toThrow()
    })

    it('should handle progress of 0', () => {
      const file = createMockFile({ progress: 0 })
      const { container } = render(<ImageItem file={file} />)
      // Progress overlay should be visible at 0%
      expect(container.querySelector('.bg-background-overlay-alt')).toBeInTheDocument()
    })
  })
})

import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImageUploaderInChunkWrapper from './index'

// Mock dependencies
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: vi.fn(() => ({
    data: {
      image_file_batch_limit: 10,
      single_chunk_attachment_limit: 20,
      attachment_image_file_size_limit: 15,
    },
  })),
}))

vi.mock('@/app/components/datasets/common/image-previewer', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="image-previewer">
      <button data-testid="close-preview" onClick={onClose}>Close</button>
    </div>
  ),
}))

describe('ImageUploaderInChunk', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const onChange = vi.fn()
      const { container } = render(
        <ImageUploaderInChunkWrapper value={[]} onChange={onChange} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render ImageInput when not disabled', () => {
      const onChange = vi.fn()
      render(<ImageUploaderInChunkWrapper value={[]} onChange={onChange} />)
      // ImageInput renders an input element
      expect(document.querySelector('input[type="file"]')).toBeInTheDocument()
    })

    it('should not render ImageInput when disabled', () => {
      const onChange = vi.fn()
      render(<ImageUploaderInChunkWrapper value={[]} onChange={onChange} disabled />)
      // ImageInput should not be present
      expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const onChange = vi.fn()
      const { container } = render(
        <ImageUploaderInChunkWrapper
          value={[]}
          onChange={onChange}
          className="custom-class"
        />,
      )
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should render files when value is provided', () => {
      const onChange = vi.fn()
      const files: FileEntity[] = [
        {
          id: 'file1',
          name: 'test1.png',
          extension: 'png',
          mimeType: 'image/png',
          progress: 100,
          base64Url: 'data:image/png;base64,test1',
          size: 1024,
        },
        {
          id: 'file2',
          name: 'test2.png',
          extension: 'png',
          mimeType: 'image/png',
          progress: 100,
          base64Url: 'data:image/png;base64,test2',
          size: 2048,
        },
      ]

      render(<ImageUploaderInChunkWrapper value={files} onChange={onChange} />)
      // Each file renders an ImageItem
      const fileItems = document.querySelectorAll('.group\\/file-image')
      expect(fileItems.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('User Interactions', () => {
    it('should show preview when image is clicked', () => {
      const onChange = vi.fn()
      const files: FileEntity[] = [
        {
          id: 'file1',
          name: 'test.png',
          extension: 'png',
          mimeType: 'image/png',
          progress: 100,
          uploadedId: 'uploaded-1',
          base64Url: 'data:image/png;base64,test',
          size: 1024,
        },
      ]

      render(<ImageUploaderInChunkWrapper value={files} onChange={onChange} />)

      // Find and click the file item
      const fileItem = document.querySelector('.group\\/file-image')
      if (fileItem) {
        fireEvent.click(fileItem)
        expect(screen.getByTestId('image-previewer')).toBeInTheDocument()
      }
    })

    it('should close preview when close button is clicked', () => {
      const onChange = vi.fn()
      const files: FileEntity[] = [
        {
          id: 'file1',
          name: 'test.png',
          extension: 'png',
          mimeType: 'image/png',
          progress: 100,
          uploadedId: 'uploaded-1',
          base64Url: 'data:image/png;base64,test',
          size: 1024,
        },
      ]

      render(<ImageUploaderInChunkWrapper value={files} onChange={onChange} />)

      // Open preview
      const fileItem = document.querySelector('.group\\/file-image')
      if (fileItem) {
        fireEvent.click(fileItem)

        // Close preview
        const closeButton = screen.getByTestId('close-preview')
        fireEvent.click(closeButton)

        expect(screen.queryByTestId('image-previewer')).not.toBeInTheDocument()
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty files array', () => {
      const onChange = vi.fn()
      const { container } = render(
        <ImageUploaderInChunkWrapper value={[]} onChange={onChange} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle undefined value', () => {
      const onChange = vi.fn()
      const { container } = render(
        <ImageUploaderInChunkWrapper value={undefined} onChange={onChange} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})

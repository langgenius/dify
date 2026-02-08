import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImageUploaderInRetrievalTestingWrapper from './index'

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

describe('ImageUploaderInRetrievalTesting', () => {
  const defaultProps = {
    textArea: <textarea data-testid="text-area" />,
    actionButton: <button data-testid="action-button">Submit</button>,
    onChange: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={[]} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render textArea prop', () => {
      render(<ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={[]} />)
      expect(screen.getByTestId('text-area')).toBeInTheDocument()
    })

    it('should render actionButton prop', () => {
      render(<ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={[]} />)
      expect(screen.getByTestId('action-button')).toBeInTheDocument()
    })

    it('should render ImageInput when showUploader is true (default)', () => {
      render(<ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={[]} />)
      expect(document.querySelector('input[type="file"]')).toBeInTheDocument()
    })

    it('should not render ImageInput when showUploader is false', () => {
      render(
        <ImageUploaderInRetrievalTestingWrapper
          {...defaultProps}
          value={[]}
          showUploader={false}
        />,
      )
      expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper
          {...defaultProps}
          value={[]}
          className="custom-class"
        />,
      )
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should apply actionAreaClassName', () => {
      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper
          {...defaultProps}
          value={[]}
          actionAreaClassName="action-area-class"
        />,
      )
      // The action area should have the custom class
      expect(container.querySelector('.action-area-class')).toBeInTheDocument()
    })

    it('should render file list when files are provided', () => {
      const files: FileEntity[] = [
        {
          id: 'file1',
          name: 'test1.png',
          extension: 'png',
          mimeType: 'image/png',
          progress: 100,
          uploadedId: 'uploaded-1',
          base64Url: 'data:image/png;base64,test1',
          size: 1024,
        },
      ]

      render(<ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={files} />)
      const fileItems = document.querySelectorAll('.group\\/file-image')
      expect(fileItems.length).toBeGreaterThanOrEqual(1)
    })

    it('should not render file list when files are empty', () => {
      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={[]} />,
      )
      // File list container should not be present
      expect(container.querySelector('.bg-background-default')).not.toBeInTheDocument()
    })

    it('should not render file list when showUploader is false', () => {
      const files: FileEntity[] = [
        {
          id: 'file1',
          name: 'test1.png',
          extension: 'png',
          mimeType: 'image/png',
          progress: 100,
          uploadedId: 'uploaded-1',
          base64Url: 'data:image/png;base64,test1',
          size: 1024,
        },
      ]

      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper
          {...defaultProps}
          value={files}
          showUploader={false}
        />,
      )
      expect(container.querySelector('.bg-background-default')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should show preview when image is clicked', () => {
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

      render(<ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={files} />)

      const fileItem = document.querySelector('.group\\/file-image')
      if (fileItem) {
        fireEvent.click(fileItem)
        expect(screen.getByTestId('image-previewer')).toBeInTheDocument()
      }
    })

    it('should close preview when close button is clicked', () => {
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

      render(<ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={files} />)

      const fileItem = document.querySelector('.group\\/file-image')
      if (fileItem) {
        fireEvent.click(fileItem)
        const closeButton = screen.getByTestId('close-preview')
        fireEvent.click(closeButton)
        expect(screen.queryByTestId('image-previewer')).not.toBeInTheDocument()
      }
    })
  })

  describe('Layout', () => {
    it('should use justify-between when showUploader is true', () => {
      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={[]} />,
      )
      expect(container.querySelector('.justify-between')).toBeInTheDocument()
    })

    it('should use justify-end when showUploader is false', () => {
      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper
          {...defaultProps}
          value={[]}
          showUploader={false}
        />,
      )
      expect(container.querySelector('.justify-end')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined value', () => {
      const { container } = render(
        <ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={undefined} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle multiple files', () => {
      const files: FileEntity[] = Array.from({ length: 5 }, (_, i) => ({
        id: `file${i}`,
        name: `test${i}.png`,
        extension: 'png',
        mimeType: 'image/png',
        progress: 100,
        uploadedId: `uploaded-${i}`,
        base64Url: `data:image/png;base64,test${i}`,
        size: 1024 * (i + 1),
      }))

      render(<ImageUploaderInRetrievalTestingWrapper {...defaultProps} value={files} />)
      const fileItems = document.querySelectorAll('.group\\/file-image')
      expect(fileItems.length).toBe(5)
    })
  })
})

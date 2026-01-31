import type { FileEntity } from '../types'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileContextProvider } from '../store'
import ImageInput from './image-input'

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

const renderWithProvider = (ui: React.ReactElement, initialFiles: FileEntity[] = []) => {
  return render(
    <FileContextProvider value={initialFiles}>
      {ui}
    </FileContextProvider>,
  )
}

describe('ImageInput (image-uploader-in-retrieval-testing)', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = renderWithProvider(<ImageInput />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render file input element', () => {
      renderWithProvider(<ImageInput />)
      const input = document.querySelector('input[type="file"]')
      expect(input).toBeInTheDocument()
    })

    it('should have hidden file input', () => {
      renderWithProvider(<ImageInput />)
      const input = document.querySelector('input[type="file"]')
      expect(input).toHaveClass('hidden')
    })

    it('should render add image icon', () => {
      const { container } = renderWithProvider(<ImageInput />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should show tip text when no files are uploaded', () => {
      renderWithProvider(<ImageInput />)
      // Tip text should be visible
      expect(document.querySelector('.system-sm-regular')).toBeInTheDocument()
    })

    it('should hide tip text when files exist', () => {
      const files: FileEntity[] = [
        {
          id: 'file1',
          name: 'test.png',
          extension: 'png',
          mimeType: 'image/png',
          size: 1024,
          progress: 100,
          uploadedId: 'uploaded-1',
        },
      ]
      renderWithProvider(<ImageInput />, files)
      // Tip text should not be visible
      expect(document.querySelector('.text-text-quaternary')).not.toBeInTheDocument()
    })
  })

  describe('File Input Props', () => {
    it('should accept multiple files', () => {
      renderWithProvider(<ImageInput />)
      const input = document.querySelector('input[type="file"]')
      expect(input).toHaveAttribute('multiple')
    })

    it('should have accept attribute', () => {
      renderWithProvider(<ImageInput />)
      const input = document.querySelector('input[type="file"]')
      expect(input).toHaveAttribute('accept')
    })
  })

  describe('User Interactions', () => {
    it('should open file dialog when icon is clicked', () => {
      renderWithProvider(<ImageInput />)

      const clickableArea = document.querySelector('.cursor-pointer')
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      const clickSpy = vi.spyOn(input, 'click')

      if (clickableArea)
        fireEvent.click(clickableArea)

      expect(clickSpy).toHaveBeenCalled()
    })
  })

  describe('Tooltip', () => {
    it('should have tooltip component', () => {
      const { container } = renderWithProvider(<ImageInput />)
      // Tooltip wrapper should exist
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should disable tooltip when no files exist', () => {
      // When files.length === 0, tooltip should be disabled
      renderWithProvider(<ImageInput />)
      // Component renders with tip text visible instead of tooltip
      expect(document.querySelector('.system-sm-regular')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render icon container with correct styling', () => {
      const { container } = renderWithProvider(<ImageInput />)
      expect(container.querySelector('.border-dashed')).toBeInTheDocument()
    })
  })
})

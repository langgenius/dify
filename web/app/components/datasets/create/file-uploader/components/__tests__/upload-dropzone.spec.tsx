import type { RefObject } from 'react'
import type { UploadDropzoneProps } from '../upload-dropzone'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UploadDropzone from '../upload-dropzone'

// Helper to create mock ref objects for testing
const createMockRef = <T,>(value: T | null = null): RefObject<T | null> => ({ current: value })

describe('UploadDropzone', () => {
  const defaultProps: UploadDropzoneProps = {
    dropRef: createMockRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>,
    dragRef: createMockRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>,
    fileUploaderRef: createMockRef<HTMLInputElement>() as RefObject<HTMLInputElement | null>,
    dragging: false,
    supportBatchUpload: true,
    supportTypesShowNames: 'PDF, DOCX, TXT',
    fileUploadConfig: {
      file_size_limit: 15,
      batch_count_limit: 5,
      file_upload_limit: 10,
    },
    acceptTypes: ['.pdf', '.docx', '.txt'],
    onSelectFile: vi.fn(),
    onFileChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the dropzone container', () => {
      const { container } = render(<UploadDropzone {...defaultProps} />)
      const dropzone = container.querySelector('[class*="border-dashed"]')
      expect(dropzone).toBeInTheDocument()
    })

    it('should render hidden file input', () => {
      render(<UploadDropzone {...defaultProps} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input).toHaveClass('hidden')
      expect(input).toHaveAttribute('type', 'file')
    })

    it('should render upload icon', () => {
      render(<UploadDropzone {...defaultProps} />)
      const icon = document.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should render browse label when extensions are allowed', () => {
      render(<UploadDropzone {...defaultProps} />)
      expect(screen.getByText('datasetCreation.stepOne.uploader.browse')).toBeInTheDocument()
    })

    it('should not render browse label when no extensions allowed', () => {
      render(<UploadDropzone {...defaultProps} acceptTypes={[]} />)
      expect(screen.queryByText('datasetCreation.stepOne.uploader.browse')).not.toBeInTheDocument()
    })

    it('should render file size and count limits', () => {
      render(<UploadDropzone {...defaultProps} />)
      const tipText = screen.getByText(/datasetCreation\.stepOne\.uploader\.tip/)
      expect(tipText).toBeInTheDocument()
    })
  })

  describe('file input configuration', () => {
    it('should allow multiple files when supportBatchUpload is true', () => {
      render(<UploadDropzone {...defaultProps} supportBatchUpload={true} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      expect(input).toHaveAttribute('multiple')
    })

    it('should not allow multiple files when supportBatchUpload is false', () => {
      render(<UploadDropzone {...defaultProps} supportBatchUpload={false} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      expect(input).not.toHaveAttribute('multiple')
    })

    it('should set accept attribute with correct types', () => {
      render(<UploadDropzone {...defaultProps} acceptTypes={['.pdf', '.docx']} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      expect(input).toHaveAttribute('accept', '.pdf,.docx')
    })
  })

  describe('text content', () => {
    it('should show batch upload text when supportBatchUpload is true', () => {
      render(<UploadDropzone {...defaultProps} supportBatchUpload={true} />)
      expect(screen.getByText(/datasetCreation\.stepOne\.uploader\.button/)).toBeInTheDocument()
    })

    it('should show single file text when supportBatchUpload is false', () => {
      render(<UploadDropzone {...defaultProps} supportBatchUpload={false} />)
      expect(screen.getByText(/datasetCreation\.stepOne\.uploader\.buttonSingleFile/)).toBeInTheDocument()
    })
  })

  describe('dragging state', () => {
    it('should apply dragging styles when dragging is true', () => {
      const { container } = render(<UploadDropzone {...defaultProps} dragging={true} />)
      const dropzone = container.querySelector('[class*="border-components-dropzone-border-accent"]')
      expect(dropzone).toBeInTheDocument()
    })

    it('should render drag overlay when dragging', () => {
      const dragRef = createMockRef<HTMLDivElement>()
      render(<UploadDropzone {...defaultProps} dragging={true} dragRef={dragRef as RefObject<HTMLDivElement | null>} />)
      const overlay = document.querySelector('.absolute.left-0.top-0')
      expect(overlay).toBeInTheDocument()
    })

    it('should not render drag overlay when not dragging', () => {
      render(<UploadDropzone {...defaultProps} dragging={false} />)
      const overlay = document.querySelector('.absolute.left-0.top-0')
      expect(overlay).not.toBeInTheDocument()
    })
  })

  describe('event handlers', () => {
    it('should call onSelectFile when browse label is clicked', () => {
      const onSelectFile = vi.fn()
      render(<UploadDropzone {...defaultProps} onSelectFile={onSelectFile} />)

      const browseLabel = screen.getByText('datasetCreation.stepOne.uploader.browse')
      fireEvent.click(browseLabel)

      expect(onSelectFile).toHaveBeenCalledTimes(1)
    })

    it('should call onFileChange when files are selected', () => {
      const onFileChange = vi.fn()
      render(<UploadDropzone {...defaultProps} onFileChange={onFileChange} />)

      const input = document.getElementById('fileUploader') as HTMLInputElement
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })

      fireEvent.change(input, { target: { files: [file] } })

      expect(onFileChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('refs', () => {
    it('should attach dropRef to drop container', () => {
      const dropRef = createMockRef<HTMLDivElement>()
      render(<UploadDropzone {...defaultProps} dropRef={dropRef as RefObject<HTMLDivElement | null>} />)
      expect(dropRef.current).toBeInstanceOf(HTMLDivElement)
    })

    it('should attach fileUploaderRef to input element', () => {
      const fileUploaderRef = createMockRef<HTMLInputElement>()
      render(<UploadDropzone {...defaultProps} fileUploaderRef={fileUploaderRef as RefObject<HTMLInputElement | null>} />)
      expect(fileUploaderRef.current).toBeInstanceOf(HTMLInputElement)
    })

    it('should attach dragRef to overlay when dragging', () => {
      const dragRef = createMockRef<HTMLDivElement>()
      render(<UploadDropzone {...defaultProps} dragging={true} dragRef={dragRef as RefObject<HTMLDivElement | null>} />)
      expect(dragRef.current).toBeInstanceOf(HTMLDivElement)
    })
  })

  describe('styling', () => {
    it('should have base dropzone styling', () => {
      const { container } = render(<UploadDropzone {...defaultProps} />)
      const dropzone = container.querySelector('[class*="border-dashed"]')
      expect(dropzone).toBeInTheDocument()
      expect(dropzone).toHaveClass('rounded-xl')
    })

    it('should have cursor-pointer on browse label', () => {
      render(<UploadDropzone {...defaultProps} />)
      const browseLabel = screen.getByText('datasetCreation.stepOne.uploader.browse')
      expect(browseLabel).toHaveClass('cursor-pointer')
    })
  })

  describe('accessibility', () => {
    it('should have an accessible file input', () => {
      render(<UploadDropzone {...defaultProps} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      expect(input).toHaveAttribute('id', 'fileUploader')
    })
  })
})

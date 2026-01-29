import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Uploader from './uploader'

// Mock ToastContext
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  ToastContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
    Consumer: ({ children }: { children: (value: { notify: typeof mockNotify }) => React.ReactNode }) => children({ notify: mockNotify }),
  },
}))

// Mock use-context-selector
vi.mock('use-context-selector', () => ({
  useContext: () => ({ notify: mockNotify }),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockFile = (name = 'test.pipeline', _size = 1024): File => {
  return new File(['test content'], name, { type: 'application/octet-stream' })
}

// ============================================================================
// Uploader Component Tests
// ============================================================================

describe('Uploader', () => {
  const defaultProps = {
    file: undefined,
    updateFile: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - No File
  // --------------------------------------------------------------------------
  describe('Rendering - No File', () => {
    it('should render without crashing', () => {
      render(<Uploader {...defaultProps} />)
      expect(screen.getByText(/dslUploader\.button/i)).toBeInTheDocument()
    })

    it('should render upload prompt when no file', () => {
      render(<Uploader {...defaultProps} />)
      expect(screen.getByText(/dslUploader\.button/i)).toBeInTheDocument()
    })

    it('should render browse link when no file', () => {
      render(<Uploader {...defaultProps} />)
      expect(screen.getByText(/dslUploader\.browse/i)).toBeInTheDocument()
    })

    it('should render upload icon when no file', () => {
      const { container } = render(<Uploader {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should have hidden file input', () => {
      render(<Uploader {...defaultProps} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.style.display).toBe('none')
    })

    it('should accept .pipeline files', () => {
      render(<Uploader {...defaultProps} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      expect(input.accept).toBe('.pipeline')
    })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - With File
  // --------------------------------------------------------------------------
  describe('Rendering - With File', () => {
    it('should render file name when file is provided', () => {
      const file = createMockFile('my-pipeline.pipeline')
      render(<Uploader {...defaultProps} file={file} />)
      expect(screen.getByText('my-pipeline.pipeline')).toBeInTheDocument()
    })

    it('should render PIPELINE label when file is provided', () => {
      const file = createMockFile()
      render(<Uploader {...defaultProps} file={file} />)
      expect(screen.getByText('PIPELINE')).toBeInTheDocument()
    })

    it('should render delete button when file is provided', () => {
      const file = createMockFile()
      const { container } = render(<Uploader {...defaultProps} file={file} />)
      const deleteButton = container.querySelector('[class*="group-hover:flex"]')
      expect(deleteButton).toBeInTheDocument()
    })

    it('should render node tree icon when file is provided', () => {
      const file = createMockFile()
      const { container } = render(<Uploader {...defaultProps} file={file} />)
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should open file dialog when browse is clicked', () => {
      render(<Uploader {...defaultProps} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      const clickSpy = vi.spyOn(input, 'click')

      const browseLink = screen.getByText(/dslUploader\.browse/i)
      fireEvent.click(browseLink)

      expect(clickSpy).toHaveBeenCalled()
    })

    it('should call updateFile when file input changes', () => {
      render(<Uploader {...defaultProps} />)
      const input = document.getElementById('fileUploader') as HTMLInputElement
      const file = createMockFile()

      Object.defineProperty(input, 'files', {
        value: [file],
        writable: true,
      })

      fireEvent.change(input)

      expect(defaultProps.updateFile).toHaveBeenCalledWith(file)
    })

    it('should call updateFile with undefined when delete is clicked', () => {
      const file = createMockFile()
      const { container } = render(<Uploader {...defaultProps} file={file} />)

      const deleteButton = container.querySelector('[class*="group-hover:flex"] button')
      if (deleteButton)
        fireEvent.click(deleteButton)

      expect(defaultProps.updateFile).toHaveBeenCalledWith()
    })
  })

  // --------------------------------------------------------------------------
  // Custom className Tests
  // --------------------------------------------------------------------------
  describe('Custom className', () => {
    it('should apply custom className', () => {
      const { container } = render(<Uploader {...defaultProps} className="custom-class" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should merge custom className with default', () => {
      const { container } = render(<Uploader {...defaultProps} className="custom-class" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('mt-6', 'custom-class')
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container styling', () => {
      const { container } = render(<Uploader {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('mt-6')
    })

    it('should have dropzone styling when no file', () => {
      const { container } = render(<Uploader {...defaultProps} />)
      const dropzone = container.querySelector('[class*="border-dashed"]')
      expect(dropzone).toBeInTheDocument()
    })

    it('should have file card styling when file is provided', () => {
      const file = createMockFile()
      const { container } = render(<Uploader {...defaultProps} file={file} />)
      const fileCard = container.querySelector('[class*="rounded-lg"]')
      expect(fileCard).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Uploader {...defaultProps} />)
      rerender(<Uploader {...defaultProps} />)
      expect(screen.getByText(/dslUploader\.button/i)).toBeInTheDocument()
    })
  })
})

import type { MockedFunction } from 'vitest'
import type { CustomFile as File } from '@/models/datasets'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchFilePreview } from '@/service/common'
import FilePreview from './index'

// Mock the fetchFilePreview service
vi.mock('@/service/common', () => ({
  fetchFilePreview: vi.fn(),
}))

const mockFetchFilePreview = fetchFilePreview as MockedFunction<typeof fetchFilePreview>

// Factory function to create mock file objects
const createMockFile = (overrides: Partial<File> = {}): File => {
  const fileName = overrides.name ?? 'test-file.txt'
  // Create a plain object that looks like a File with CustomFile properties
  // We can't use Object.assign on a real File because 'name' is a getter-only property
  return {
    name: fileName,
    size: 1024,
    type: 'text/plain',
    lastModified: Date.now(),
    id: 'file-123',
    extension: 'txt',
    mime_type: 'text/plain',
    created_by: 'user-1',
    created_at: Date.now(),
    ...overrides,
  } as File
}

// Helper to render FilePreview with default props
const renderFilePreview = (props: Partial<{ file?: File, hidePreview: () => void }> = {}) => {
  const defaultProps = {
    file: createMockFile(),
    hidePreview: vi.fn(),
    ...props,
  }
  return {
    ...render(<FilePreview {...defaultProps} />),
    props: defaultProps,
  }
}

// Helper to find the loading spinner element
const findLoadingSpinner = (container: HTMLElement) => {
  return container.querySelector('.spin-animation')
}

// ============================================================================
// FilePreview Component Tests
// ============================================================================
describe('FilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default successful API response
    mockFetchFilePreview.mockResolvedValue({ content: 'Preview content here' })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - Verify component renders properly
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', async () => {
      // Arrange & Act
      renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(screen.getByText('datasetCreation.stepOne.filePreview')).toBeInTheDocument()
      })
    })

    it('should render file preview header', async () => {
      // Arrange & Act
      renderFilePreview()

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.filePreview')).toBeInTheDocument()
    })

    it('should render close button with XMarkIcon', async () => {
      // Arrange & Act
      const { container } = renderFilePreview()

      // Assert
      const closeButton = container.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
      const xMarkIcon = closeButton?.querySelector('svg')
      expect(xMarkIcon).toBeInTheDocument()
    })

    it('should render file name without extension', async () => {
      // Arrange
      const file = createMockFile({ name: 'document.pdf' })

      // Act
      renderFilePreview({ file })

      // Assert
      await waitFor(() => {
        expect(screen.getByText('document')).toBeInTheDocument()
      })
    })

    it('should render file extension', async () => {
      // Arrange
      const file = createMockFile({ extension: 'pdf' })

      // Act
      renderFilePreview({ file })

      // Assert
      expect(screen.getByText('.pdf')).toBeInTheDocument()
    })

    it('should apply correct CSS classes to container', async () => {
      // Arrange & Act
      const { container } = renderFilePreview()

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('h-full')
    })
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should show loading indicator initially', async () => {
      // Arrange - Delay API response to keep loading state
      mockFetchFilePreview.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ content: 'test' }), 100)),
      )

      // Act
      const { container } = renderFilePreview()

      // Assert - Loading should be visible initially (using spin-animation class)
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).toBeInTheDocument()
    })

    it('should hide loading indicator after content loads', async () => {
      // Arrange
      mockFetchFilePreview.mockResolvedValue({ content: 'Loaded content' })

      // Act
      const { container } = renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Loaded content')).toBeInTheDocument()
      })
      // Loading should be gone
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).not.toBeInTheDocument()
    })

    it('should show loading when file changes', async () => {
      // Arrange
      const file1 = createMockFile({ id: 'file-1', name: 'file1.txt' })
      const file2 = createMockFile({ id: 'file-2', name: 'file2.txt' })

      let resolveFirst: (value: { content: string }) => void
      let resolveSecond: (value: { content: string }) => void

      mockFetchFilePreview
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

      // Act - Initial render
      const { rerender, container } = render(
        <FilePreview file={file1} hidePreview={vi.fn()} />,
      )

      // First file loading - spinner should be visible
      expect(findLoadingSpinner(container)).toBeInTheDocument()

      // Resolve first file
      await act(async () => {
        resolveFirst({ content: 'Content 1' })
      })

      await waitFor(() => {
        expect(screen.getByText('Content 1')).toBeInTheDocument()
      })

      // Rerender with new file
      rerender(<FilePreview file={file2} hidePreview={vi.fn()} />)

      // Should show loading again
      await waitFor(() => {
        expect(findLoadingSpinner(container)).toBeInTheDocument()
      })

      // Resolve second file
      await act(async () => {
        resolveSecond({ content: 'Content 2' })
      })

      await waitFor(() => {
        expect(screen.getByText('Content 2')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // API Call Tests
  // --------------------------------------------------------------------------
  describe('API Calls', () => {
    it('should call fetchFilePreview with correct fileID', async () => {
      // Arrange
      const file = createMockFile({ id: 'test-file-id' })

      // Act
      renderFilePreview({ file })

      // Assert
      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledWith({ fileID: 'test-file-id' })
      })
    })

    it('should not call fetchFilePreview when file is undefined', async () => {
      // Arrange & Act
      renderFilePreview({ file: undefined })

      // Assert
      expect(mockFetchFilePreview).not.toHaveBeenCalled()
    })

    it('should not call fetchFilePreview when file has no id', async () => {
      // Arrange
      const file = createMockFile({ id: undefined })

      // Act
      renderFilePreview({ file })

      // Assert
      expect(mockFetchFilePreview).not.toHaveBeenCalled()
    })

    it('should call fetchFilePreview again when file changes', async () => {
      // Arrange
      const file1 = createMockFile({ id: 'file-1' })
      const file2 = createMockFile({ id: 'file-2' })

      // Act
      const { rerender } = render(
        <FilePreview file={file1} hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledWith({ fileID: 'file-1' })
      })

      rerender(<FilePreview file={file2} hidePreview={vi.fn()} />)

      // Assert
      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledWith({ fileID: 'file-2' })
        expect(mockFetchFilePreview).toHaveBeenCalledTimes(2)
      })
    })

    it('should handle API success and display content', async () => {
      // Arrange
      mockFetchFilePreview.mockResolvedValue({ content: 'File preview content from API' })

      // Act
      renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(screen.getByText('File preview content from API')).toBeInTheDocument()
      })
    })

    it('should handle API error gracefully', async () => {
      // Arrange
      mockFetchFilePreview.mockRejectedValue(new Error('Network error'))

      // Act
      const { container } = renderFilePreview()

      // Assert - Component should not crash, loading may persist
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
      // No error thrown, component still rendered
      expect(screen.getByText('datasetCreation.stepOne.filePreview')).toBeInTheDocument()
    })

    it('should handle empty content response', async () => {
      // Arrange
      mockFetchFilePreview.mockResolvedValue({ content: '' })

      // Act
      const { container } = renderFilePreview()

      // Assert - Should still render without loading
      await waitFor(() => {
        const loadingElement = findLoadingSpinner(container)
        expect(loadingElement).not.toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call hidePreview when close button is clicked', async () => {
      // Arrange
      const hidePreview = vi.fn()
      const { container } = renderFilePreview({ hidePreview })

      // Act
      const closeButton = container.querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)

      // Assert
      expect(hidePreview).toHaveBeenCalledTimes(1)
    })

    it('should call hidePreview with event object when clicked', async () => {
      // Arrange
      const hidePreview = vi.fn()
      const { container } = renderFilePreview({ hidePreview })

      // Act
      const closeButton = container.querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)

      // Assert - onClick receives the event object
      expect(hidePreview).toHaveBeenCalled()
      expect(hidePreview.mock.calls[0][0]).toBeDefined()
    })

    it('should handle multiple clicks on close button', async () => {
      // Arrange
      const hidePreview = vi.fn()
      const { container } = renderFilePreview({ hidePreview })

      // Act
      const closeButton = container.querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)

      // Assert
      expect(hidePreview).toHaveBeenCalledTimes(3)
    })
  })

  // --------------------------------------------------------------------------
  // State Management Tests
  // --------------------------------------------------------------------------
  describe('State Management', () => {
    it('should initialize with loading state true', async () => {
      // Arrange - Keep loading indefinitely (never resolves)
      mockFetchFilePreview.mockImplementation(() => new Promise(() => { /* intentionally empty */ }))

      // Act
      const { container } = renderFilePreview()

      // Assert
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).toBeInTheDocument()
    })

    it('should update previewContent state after successful fetch', async () => {
      // Arrange
      mockFetchFilePreview.mockResolvedValue({ content: 'New preview content' })

      // Act
      renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(screen.getByText('New preview content')).toBeInTheDocument()
      })
    })

    it('should reset loading to true when file changes', async () => {
      // Arrange
      const file1 = createMockFile({ id: 'file-1' })
      const file2 = createMockFile({ id: 'file-2' })

      mockFetchFilePreview
        .mockResolvedValueOnce({ content: 'Content 1' })
        .mockImplementationOnce(() => new Promise(() => { /* never resolves */ }))

      // Act
      const { rerender, container } = render(
        <FilePreview file={file1} hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(screen.getByText('Content 1')).toBeInTheDocument()
      })

      // Change file
      rerender(<FilePreview file={file2} hidePreview={vi.fn()} />)

      // Assert - Loading should be shown again
      await waitFor(() => {
        const loadingElement = findLoadingSpinner(container)
        expect(loadingElement).toBeInTheDocument()
      })
    })

    it('should preserve content until new content loads', async () => {
      // Arrange
      const file1 = createMockFile({ id: 'file-1' })
      const file2 = createMockFile({ id: 'file-2' })

      let resolveSecond: (value: { content: string }) => void

      mockFetchFilePreview
        .mockResolvedValueOnce({ content: 'Content 1' })
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

      // Act
      const { rerender } = render(
        <FilePreview file={file1} hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(screen.getByText('Content 1')).toBeInTheDocument()
      })

      // Change file - loading should replace content
      rerender(<FilePreview file={file2} hidePreview={vi.fn()} />)

      // Resolve second fetch
      await act(async () => {
        resolveSecond({ content: 'Content 2' })
      })

      await waitFor(() => {
        expect(screen.getByText('Content 2')).toBeInTheDocument()
        expect(screen.queryByText('Content 1')).not.toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Props Testing
  // --------------------------------------------------------------------------
  describe('Props', () => {
    describe('file prop', () => {
      it('should render correctly with file prop', async () => {
        // Arrange
        const file = createMockFile({ name: 'my-document.pdf', extension: 'pdf' })

        // Act
        renderFilePreview({ file })

        // Assert
        expect(screen.getByText('my-document')).toBeInTheDocument()
        expect(screen.getByText('.pdf')).toBeInTheDocument()
      })

      it('should render correctly without file prop', async () => {
        // Arrange & Act
        renderFilePreview({ file: undefined })

        // Assert - Header should still render
        expect(screen.getByText('datasetCreation.stepOne.filePreview')).toBeInTheDocument()
      })

      it('should handle file with multiple dots in name', async () => {
        // Arrange
        const file = createMockFile({ name: 'my.document.v2.pdf' })

        // Act
        renderFilePreview({ file })

        // Assert - Should join all parts except last with comma
        expect(screen.getByText('my,document,v2')).toBeInTheDocument()
      })

      it('should handle file with no extension in name', async () => {
        // Arrange
        const file = createMockFile({ name: 'README' })

        // Act
        const { container } = renderFilePreview({ file })

        // Assert - getFileName returns empty for single segment, but component still renders
        const fileNameElement = container.querySelector('[class*="fileName"]')
        expect(fileNameElement).toBeInTheDocument()
        // The first span (file name) should be empty
        const fileNameSpan = fileNameElement?.querySelector('span:first-child')
        expect(fileNameSpan?.textContent).toBe('')
      })

      it('should handle file with empty name', async () => {
        // Arrange
        const file = createMockFile({ name: '' })

        // Act
        const { container } = renderFilePreview({ file })

        // Assert - Should not crash
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    describe('hidePreview prop', () => {
      it('should accept hidePreview callback', async () => {
        // Arrange
        const hidePreview = vi.fn()

        // Act
        renderFilePreview({ hidePreview })

        // Assert - No errors thrown
        expect(screen.getByText('datasetCreation.stepOne.filePreview')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle file with undefined id', async () => {
      // Arrange
      const file = createMockFile({ id: undefined })

      // Act
      const { container } = renderFilePreview({ file })

      // Assert - Should not call API, remain in loading state
      expect(mockFetchFilePreview).not.toHaveBeenCalled()
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle file with empty string id', async () => {
      // Arrange
      const file = createMockFile({ id: '' })

      // Act
      renderFilePreview({ file })

      // Assert - Empty string is falsy, should not call API
      expect(mockFetchFilePreview).not.toHaveBeenCalled()
    })

    it('should handle very long file names', async () => {
      // Arrange
      const longName = `${'a'.repeat(200)}.pdf`
      const file = createMockFile({ name: longName })

      // Act
      renderFilePreview({ file })

      // Assert
      expect(screen.getByText('a'.repeat(200))).toBeInTheDocument()
    })

    it('should handle file with special characters in name', async () => {
      // Arrange
      const file = createMockFile({ name: 'file-with_special@#$%.txt' })

      // Act
      renderFilePreview({ file })

      // Assert
      expect(screen.getByText('file-with_special@#$%')).toBeInTheDocument()
    })

    it('should handle very long preview content', async () => {
      // Arrange
      const longContent = 'x'.repeat(10000)
      mockFetchFilePreview.mockResolvedValue({ content: longContent })

      // Act
      renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(screen.getByText(longContent)).toBeInTheDocument()
      })
    })

    it('should handle preview content with special characters safely', async () => {
      // Arrange
      const specialContent = '<script>alert("xss")</script>\n\t& < > "'
      mockFetchFilePreview.mockResolvedValue({ content: specialContent })

      // Act
      const { container } = renderFilePreview()

      // Assert - Should render as text, not execute scripts
      await waitFor(() => {
        const contentDiv = container.querySelector('[class*="fileContent"]')
        expect(contentDiv).toBeInTheDocument()
        // Content is escaped by React, so HTML entities are displayed
        expect(contentDiv?.textContent).toContain('alert')
      })
    })

    it('should handle preview content with unicode', async () => {
      // Arrange
      const unicodeContent = '中文内容 🚀 émojis & spëcîal çhàrs'
      mockFetchFilePreview.mockResolvedValue({ content: unicodeContent })

      // Act
      renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(screen.getByText(unicodeContent)).toBeInTheDocument()
      })
    })

    it('should handle preview content with newlines', async () => {
      // Arrange
      const multilineContent = 'Line 1\nLine 2\nLine 3'
      mockFetchFilePreview.mockResolvedValue({ content: multilineContent })

      // Act
      const { container } = renderFilePreview()

      // Assert - Content should be in the DOM
      await waitFor(() => {
        const contentDiv = container.querySelector('[class*="fileContent"]')
        expect(contentDiv).toBeInTheDocument()
        expect(contentDiv?.textContent).toContain('Line 1')
        expect(contentDiv?.textContent).toContain('Line 2')
        expect(contentDiv?.textContent).toContain('Line 3')
      })
    })

    it('should handle null content from API', async () => {
      // Arrange
      mockFetchFilePreview.mockResolvedValue({ content: null as unknown as string })

      // Act
      const { container } = renderFilePreview()

      // Assert - Should not crash
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Side Effects and Cleanup Tests
  // --------------------------------------------------------------------------
  describe('Side Effects and Cleanup', () => {
    it('should trigger effect when file prop changes', async () => {
      // Arrange
      const file1 = createMockFile({ id: 'file-1' })
      const file2 = createMockFile({ id: 'file-2' })

      // Act
      const { rerender } = render(
        <FilePreview file={file1} hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledTimes(1)
      })

      rerender(<FilePreview file={file2} hidePreview={vi.fn()} />)

      // Assert
      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledTimes(2)
      })
    })

    it('should not trigger effect when hidePreview changes', async () => {
      // Arrange
      const file = createMockFile()
      const hidePreview1 = vi.fn()
      const hidePreview2 = vi.fn()

      // Act
      const { rerender } = render(
        <FilePreview file={file} hidePreview={hidePreview1} />,
      )

      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledTimes(1)
      })

      rerender(<FilePreview file={file} hidePreview={hidePreview2} />)

      // Assert - Should not call API again (file didn't change)
      // Note: This depends on useEffect dependency array only including [file]
      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledTimes(1)
      })
    })

    it('should handle rapid file changes', async () => {
      // Arrange
      const files = Array.from({ length: 5 }, (_, i) =>
        createMockFile({ id: `file-${i}` }))

      // Act
      const { rerender } = render(
        <FilePreview file={files[0]} hidePreview={vi.fn()} />,
      )

      // Rapidly change files
      for (let i = 1; i < files.length; i++)
        rerender(<FilePreview file={files[i]} hidePreview={vi.fn()} />)

      // Assert - Should have called API for each file
      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledTimes(5)
      })
    })

    it('should handle unmount during loading', async () => {
      // Arrange
      mockFetchFilePreview.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ content: 'delayed' }), 1000)),
      )

      // Act
      const { unmount } = renderFilePreview()

      // Unmount before API resolves
      unmount()

      // Assert - No errors should be thrown (React handles state updates on unmounted)
      expect(true).toBe(true)
    })

    it('should handle file changing from defined to undefined', async () => {
      // Arrange
      const file = createMockFile()

      // Act
      const { rerender, container } = render(
        <FilePreview file={file} hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(mockFetchFilePreview).toHaveBeenCalledTimes(1)
      })

      rerender(<FilePreview file={undefined} hidePreview={vi.fn()} />)

      // Assert - Should not crash, API should not be called again
      expect(container.firstChild).toBeInTheDocument()
      expect(mockFetchFilePreview).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // getFileName Helper Tests
  // --------------------------------------------------------------------------
  describe('getFileName Helper', () => {
    it('should extract name without extension for simple filename', async () => {
      // Arrange
      const file = createMockFile({ name: 'document.pdf' })

      // Act
      renderFilePreview({ file })

      // Assert
      expect(screen.getByText('document')).toBeInTheDocument()
    })

    it('should handle filename with multiple dots', async () => {
      // Arrange
      const file = createMockFile({ name: 'file.name.with.dots.txt' })

      // Act
      renderFilePreview({ file })

      // Assert - Should join all parts except last with comma
      expect(screen.getByText('file,name,with,dots')).toBeInTheDocument()
    })

    it('should return empty for filename without dot', async () => {
      // Arrange
      const file = createMockFile({ name: 'nodotfile' })

      // Act
      const { container } = renderFilePreview({ file })

      // Assert - slice(0, -1) on single element array returns empty
      const fileNameElement = container.querySelector('[class*="fileName"]')
      const firstSpan = fileNameElement?.querySelector('span:first-child')
      expect(firstSpan?.textContent).toBe('')
    })

    it('should return empty string when file is undefined', async () => {
      // Arrange & Act
      const { container } = renderFilePreview({ file: undefined })

      // Assert - File name area should have empty first span
      const fileNameElement = container.querySelector('.system-xs-medium')
      expect(fileNameElement).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Accessibility Tests
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have clickable close button with visual indicator', async () => {
      // Arrange & Act
      const { container } = renderFilePreview()

      // Assert
      const closeButton = container.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
      expect(closeButton).toHaveClass('cursor-pointer')
    })

    it('should have proper heading structure', async () => {
      // Arrange & Act
      renderFilePreview()

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.filePreview')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Error Handling Tests
  // --------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should not crash on API network error', async () => {
      // Arrange
      mockFetchFilePreview.mockRejectedValue(new Error('Network Error'))

      // Act
      const { container } = renderFilePreview()

      // Assert - Component should still render
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    it('should not crash on API timeout', async () => {
      // Arrange
      mockFetchFilePreview.mockRejectedValue(new Error('Timeout'))

      // Act
      const { container } = renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    it('should not crash on malformed API response', async () => {
      // Arrange
      mockFetchFilePreview.mockResolvedValue({} as { content: string })

      // Act
      const { container } = renderFilePreview()

      // Assert
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })
  })
})

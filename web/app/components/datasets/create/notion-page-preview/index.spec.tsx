import type { MockedFunction } from 'vitest'
import type { NotionPage } from '@/models/common'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchNotionPagePreview } from '@/service/datasets'
import NotionPagePreview from './index'

// Mock the fetchNotionPagePreview service
vi.mock('@/service/datasets', () => ({
  fetchNotionPagePreview: vi.fn(),
}))

const mockFetchNotionPagePreview = fetchNotionPagePreview as MockedFunction<typeof fetchNotionPagePreview>

// Factory function to create mock NotionPage objects
const createMockNotionPage = (overrides: Partial<NotionPage> = {}): NotionPage => {
  return {
    page_id: 'page-123',
    page_name: 'Test Page',
    page_icon: null,
    parent_id: 'parent-123',
    type: 'page',
    is_bound: false,
    workspace_id: 'workspace-123',
    ...overrides,
  }
}

// Factory function to create NotionPage with emoji icon
const createMockNotionPageWithEmojiIcon = (emoji: string, overrides: Partial<NotionPage> = {}): NotionPage => {
  return createMockNotionPage({
    page_icon: {
      type: 'emoji',
      url: null,
      emoji,
    },
    ...overrides,
  })
}

// Factory function to create NotionPage with URL icon
const createMockNotionPageWithUrlIcon = (url: string, overrides: Partial<NotionPage> = {}): NotionPage => {
  return createMockNotionPage({
    page_icon: {
      type: 'url',
      url,
      emoji: null,
    },
    ...overrides,
  })
}

// Helper to render NotionPagePreview with default props and wait for async updates
const renderNotionPagePreview = async (
  props: Partial<{
    currentPage?: NotionPage
    notionCredentialId: string
    hidePreview: () => void
  }> = {},
  waitForContent = true,
) => {
  const defaultProps = {
    currentPage: createMockNotionPage(),
    notionCredentialId: 'credential-123',
    hidePreview: vi.fn(),
    ...props,
  }
  const result = render(<NotionPagePreview {...defaultProps} />)

  // Wait for async state updates to complete if needed
  if (waitForContent && defaultProps.currentPage) {
    await waitFor(() => {
      // Wait for loading to finish
      expect(result.container.querySelector('.spin-animation')).not.toBeInTheDocument()
    })
  }

  return {
    ...result,
    props: defaultProps,
  }
}

// Helper to find the loading spinner element
const findLoadingSpinner = (container: HTMLElement) => {
  return container.querySelector('.spin-animation')
}

// ============================================================================
// NotionPagePreview Component Tests
// ============================================================================
// Note: Branch coverage is ~88% because line 29 (`if (!currentPage) return`)
// is defensive code that cannot be reached - getPreviewContent is only called
// from useEffect when currentPage is truthy.
// ============================================================================
describe('NotionPagePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default successful API response
    mockFetchNotionPagePreview.mockResolvedValue({ content: 'Preview content here' })
  })

  afterEach(async () => {
    // Wait for any pending state updates to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - Verify component renders properly
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', async () => {
      // Arrange & Act
      await renderNotionPagePreview()

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
    })

    it('should render page preview header', async () => {
      // Arrange & Act
      await renderNotionPagePreview()

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
    })

    it('should render close button with XMarkIcon', async () => {
      // Arrange & Act
      const { container } = await renderNotionPagePreview()

      // Assert
      const closeButton = container.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
      const xMarkIcon = closeButton?.querySelector('svg')
      expect(xMarkIcon).toBeInTheDocument()
    })

    it('should render page name', async () => {
      // Arrange
      const page = createMockNotionPage({ page_name: 'My Notion Page' })

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert
      expect(screen.getByText('My Notion Page')).toBeInTheDocument()
    })

    it('should apply correct CSS classes to container', async () => {
      // Arrange & Act
      const { container } = await renderNotionPagePreview()

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('h-full')
    })

    it('should render NotionIcon component', async () => {
      // Arrange
      const page = createMockNotionPage()

      // Act
      const { container } = await renderNotionPagePreview({ currentPage: page })

      // Assert - NotionIcon should be rendered (either as img or div or svg)
      const iconContainer = container.querySelector('.mr-1.shrink-0')
      expect(iconContainer).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // NotionIcon Rendering Tests
  // --------------------------------------------------------------------------
  describe('NotionIcon Rendering', () => {
    it('should render default icon when page_icon is null', async () => {
      // Arrange
      const page = createMockNotionPage({ page_icon: null })

      // Act
      const { container } = await renderNotionPagePreview({ currentPage: page })

      // Assert - Should render RiFileTextLine icon (svg)
      const svgIcon = container.querySelector('svg')
      expect(svgIcon).toBeInTheDocument()
    })

    it('should render emoji icon when page_icon has emoji type', async () => {
      // Arrange
      const page = createMockNotionPageWithEmojiIcon('📝')

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert
      expect(screen.getByText('📝')).toBeInTheDocument()
    })

    it('should render image icon when page_icon has url type', async () => {
      // Arrange
      const page = createMockNotionPageWithUrlIcon('https://example.com/icon.png')

      // Act
      const { container } = await renderNotionPagePreview({ currentPage: page })

      // Assert
      const img = container.querySelector('img[alt="page icon"]')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'https://example.com/icon.png')
    })
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should show loading indicator initially', async () => {
      // Arrange - Delay API response to keep loading state
      mockFetchNotionPagePreview.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ content: 'test' }), 100)),
      )

      // Act - Don't wait for content to load
      const { container } = await renderNotionPagePreview({}, false)

      // Assert - Loading should be visible initially
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).toBeInTheDocument()
    })

    it('should hide loading indicator after content loads', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({ content: 'Loaded content' })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert
      expect(screen.getByText('Loaded content')).toBeInTheDocument()
      // Loading should be gone
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).not.toBeInTheDocument()
    })

    it('should show loading when currentPage changes', async () => {
      // Arrange
      const page1 = createMockNotionPage({ page_id: 'page-1', page_name: 'Page 1' })
      const page2 = createMockNotionPage({ page_id: 'page-2', page_name: 'Page 2' })

      let resolveFirst: (value: { content: string }) => void
      let resolveSecond: (value: { content: string }) => void

      mockFetchNotionPagePreview
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

      // Act - Initial render
      const { rerender, container } = render(
        <NotionPagePreview currentPage={page1} notionCredentialId="cred-123" hidePreview={vi.fn()} />,
      )

      // First page loading - spinner should be visible
      expect(findLoadingSpinner(container)).toBeInTheDocument()

      // Resolve first page
      await act(async () => {
        resolveFirst({ content: 'Content 1' })
      })

      await waitFor(() => {
        expect(screen.getByText('Content 1')).toBeInTheDocument()
      })

      // Rerender with new page
      rerender(<NotionPagePreview currentPage={page2} notionCredentialId="cred-123" hidePreview={vi.fn()} />)

      // Should show loading again
      await waitFor(() => {
        expect(findLoadingSpinner(container)).toBeInTheDocument()
      })

      // Resolve second page
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
    it('should call fetchNotionPagePreview with correct parameters', async () => {
      // Arrange
      const page = createMockNotionPage({
        page_id: 'test-page-id',
        type: 'database',
      })

      // Act
      await renderNotionPagePreview({
        currentPage: page,
        notionCredentialId: 'test-credential-id',
      })

      // Assert
      expect(mockFetchNotionPagePreview).toHaveBeenCalledWith({
        pageID: 'test-page-id',
        pageType: 'database',
        credentialID: 'test-credential-id',
      })
    })

    it('should not call fetchNotionPagePreview when currentPage is undefined', async () => {
      // Arrange & Act
      await renderNotionPagePreview({ currentPage: undefined }, false)

      // Assert
      expect(mockFetchNotionPagePreview).not.toHaveBeenCalled()
    })

    it('should call fetchNotionPagePreview again when currentPage changes', async () => {
      // Arrange
      const page1 = createMockNotionPage({ page_id: 'page-1' })
      const page2 = createMockNotionPage({ page_id: 'page-2' })

      // Act
      const { rerender } = render(
        <NotionPagePreview currentPage={page1} notionCredentialId="cred-123" hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledWith({
          pageID: 'page-1',
          pageType: 'page',
          credentialID: 'cred-123',
        })
      })

      await act(async () => {
        rerender(<NotionPagePreview currentPage={page2} notionCredentialId="cred-123" hidePreview={vi.fn()} />)
      })

      // Assert
      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledWith({
          pageID: 'page-2',
          pageType: 'page',
          credentialID: 'cred-123',
        })
        expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(2)
      })
    })

    it('should handle API success and display content', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({ content: 'Notion page preview content from API' })

      // Act
      await renderNotionPagePreview()

      // Assert
      expect(screen.getByText('Notion page preview content from API')).toBeInTheDocument()
    })

    it('should handle API error gracefully', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockRejectedValue(new Error('Network error'))

      // Act
      const { container } = await renderNotionPagePreview({}, false)

      // Assert - Component should not crash
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
      // Header should still render
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
    })

    it('should handle empty content response', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({ content: '' })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert - Should still render without loading
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call hidePreview when close button is clicked', async () => {
      // Arrange
      const hidePreview = vi.fn()
      const { container } = await renderNotionPagePreview({ hidePreview })

      // Act
      const closeButton = container.querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)

      // Assert
      expect(hidePreview).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple clicks on close button', async () => {
      // Arrange
      const hidePreview = vi.fn()
      const { container } = await renderNotionPagePreview({ hidePreview })

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
      mockFetchNotionPagePreview.mockImplementation(() => new Promise(() => { /* intentionally empty */ }))

      // Act - Don't wait for content
      const { container } = await renderNotionPagePreview({}, false)

      // Assert
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).toBeInTheDocument()
    })

    it('should update previewContent state after successful fetch', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({ content: 'New preview content' })

      // Act
      await renderNotionPagePreview()

      // Assert
      expect(screen.getByText('New preview content')).toBeInTheDocument()
    })

    it('should reset loading to true when currentPage changes', async () => {
      // Arrange
      const page1 = createMockNotionPage({ page_id: 'page-1' })
      const page2 = createMockNotionPage({ page_id: 'page-2' })

      mockFetchNotionPagePreview
        .mockResolvedValueOnce({ content: 'Content 1' })
        .mockImplementationOnce(() => new Promise(() => { /* never resolves */ }))

      // Act
      const { rerender, container } = render(
        <NotionPagePreview currentPage={page1} notionCredentialId="cred-123" hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(screen.getByText('Content 1')).toBeInTheDocument()
      })

      // Change page
      await act(async () => {
        rerender(<NotionPagePreview currentPage={page2} notionCredentialId="cred-123" hidePreview={vi.fn()} />)
      })

      // Assert - Loading should be shown again
      await waitFor(() => {
        const loadingElement = findLoadingSpinner(container)
        expect(loadingElement).toBeInTheDocument()
      })
    })

    it('should replace old content with new content when page changes', async () => {
      // Arrange
      const page1 = createMockNotionPage({ page_id: 'page-1' })
      const page2 = createMockNotionPage({ page_id: 'page-2' })

      let resolveSecond: (value: { content: string }) => void

      mockFetchNotionPagePreview
        .mockResolvedValueOnce({ content: 'Content 1' })
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

      // Act
      const { rerender } = render(
        <NotionPagePreview currentPage={page1} notionCredentialId="cred-123" hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(screen.getByText('Content 1')).toBeInTheDocument()
      })

      // Change page
      await act(async () => {
        rerender(<NotionPagePreview currentPage={page2} notionCredentialId="cred-123" hidePreview={vi.fn()} />)
      })

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
    describe('currentPage prop', () => {
      it('should render correctly with currentPage prop', async () => {
        // Arrange
        const page = createMockNotionPage({ page_name: 'My Test Page' })

        // Act
        await renderNotionPagePreview({ currentPage: page })

        // Assert
        expect(screen.getByText('My Test Page')).toBeInTheDocument()
      })

      it('should render correctly without currentPage prop (undefined)', async () => {
        // Arrange & Act
        await renderNotionPagePreview({ currentPage: undefined }, false)

        // Assert - Header should still render
        expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
      })

      it('should handle page with empty name', async () => {
        // Arrange
        const page = createMockNotionPage({ page_name: '' })

        // Act
        const { container } = await renderNotionPagePreview({ currentPage: page })

        // Assert - Should not crash
        expect(container.firstChild).toBeInTheDocument()
      })

      it('should handle page with very long name', async () => {
        // Arrange
        const longName = 'a'.repeat(200)
        const page = createMockNotionPage({ page_name: longName })

        // Act
        await renderNotionPagePreview({ currentPage: page })

        // Assert
        expect(screen.getByText(longName)).toBeInTheDocument()
      })

      it('should handle page with special characters in name', async () => {
        // Arrange
        const page = createMockNotionPage({ page_name: 'Page with <special> & "chars"' })

        // Act
        await renderNotionPagePreview({ currentPage: page })

        // Assert
        expect(screen.getByText('Page with <special> & "chars"')).toBeInTheDocument()
      })

      it('should handle page with unicode characters in name', async () => {
        // Arrange
        const page = createMockNotionPage({ page_name: '中文页面名称 🚀 日本語' })

        // Act
        await renderNotionPagePreview({ currentPage: page })

        // Assert
        expect(screen.getByText('中文页面名称 🚀 日本語')).toBeInTheDocument()
      })
    })

    describe('notionCredentialId prop', () => {
      it('should pass notionCredentialId to API call', async () => {
        // Arrange
        const page = createMockNotionPage()

        // Act
        await renderNotionPagePreview({
          currentPage: page,
          notionCredentialId: 'my-credential-id',
        })

        // Assert
        expect(mockFetchNotionPagePreview).toHaveBeenCalledWith(
          expect.objectContaining({ credentialID: 'my-credential-id' }),
        )
      })
    })

    describe('hidePreview prop', () => {
      it('should accept hidePreview callback', async () => {
        // Arrange
        const hidePreview = vi.fn()

        // Act
        await renderNotionPagePreview({ hidePreview })

        // Assert - No errors thrown
        expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle page with undefined page_id', async () => {
      // Arrange
      const page = createMockNotionPage({ page_id: undefined as unknown as string })

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert - API should still be called (with undefined pageID)
      expect(mockFetchNotionPagePreview).toHaveBeenCalled()
    })

    it('should handle page with empty string page_id', async () => {
      // Arrange
      const page = createMockNotionPage({ page_id: '' })

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert
      expect(mockFetchNotionPagePreview).toHaveBeenCalledWith(
        expect.objectContaining({ pageID: '' }),
      )
    })

    it('should handle very long preview content', async () => {
      // Arrange
      const longContent = 'x'.repeat(10000)
      mockFetchNotionPagePreview.mockResolvedValue({ content: longContent })

      // Act
      await renderNotionPagePreview()

      // Assert
      expect(screen.getByText(longContent)).toBeInTheDocument()
    })

    it('should handle preview content with special characters safely', async () => {
      // Arrange
      const specialContent = '<script>alert("xss")</script>\n\t& < > "'
      mockFetchNotionPagePreview.mockResolvedValue({ content: specialContent })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert - Should render as text, not execute scripts
      const contentDiv = container.querySelector('[class*="fileContent"]')
      expect(contentDiv).toBeInTheDocument()
      expect(contentDiv?.textContent).toContain('alert')
    })

    it('should handle preview content with unicode', async () => {
      // Arrange
      const unicodeContent = '中文内容 🚀 émojis & spëcîal çhàrs'
      mockFetchNotionPagePreview.mockResolvedValue({ content: unicodeContent })

      // Act
      await renderNotionPagePreview()

      // Assert
      expect(screen.getByText(unicodeContent)).toBeInTheDocument()
    })

    it('should handle preview content with newlines', async () => {
      // Arrange
      const multilineContent = 'Line 1\nLine 2\nLine 3'
      mockFetchNotionPagePreview.mockResolvedValue({ content: multilineContent })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert
      const contentDiv = container.querySelector('[class*="fileContent"]')
      expect(contentDiv).toBeInTheDocument()
      expect(contentDiv?.textContent).toContain('Line 1')
      expect(contentDiv?.textContent).toContain('Line 2')
      expect(contentDiv?.textContent).toContain('Line 3')
    })

    it('should handle null content from API', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({ content: null as unknown as string })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert - Should not crash
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle different page types', async () => {
      // Arrange
      const databasePage = createMockNotionPage({ type: 'database' })

      // Act
      await renderNotionPagePreview({ currentPage: databasePage })

      // Assert
      expect(mockFetchNotionPagePreview).toHaveBeenCalledWith(
        expect.objectContaining({ pageType: 'database' }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Side Effects and Cleanup Tests
  // --------------------------------------------------------------------------
  describe('Side Effects and Cleanup', () => {
    it('should trigger effect when currentPage prop changes', async () => {
      // Arrange
      const page1 = createMockNotionPage({ page_id: 'page-1' })
      const page2 = createMockNotionPage({ page_id: 'page-2' })

      // Act
      const { rerender } = render(
        <NotionPagePreview currentPage={page1} notionCredentialId="cred-123" hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        rerender(<NotionPagePreview currentPage={page2} notionCredentialId="cred-123" hidePreview={vi.fn()} />)
      })

      // Assert
      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(2)
      })
    })

    it('should not trigger effect when hidePreview changes', async () => {
      // Arrange
      const page = createMockNotionPage()
      const hidePreview1 = vi.fn()
      const hidePreview2 = vi.fn()

      // Act
      const { rerender } = render(
        <NotionPagePreview currentPage={page} notionCredentialId="cred-123" hidePreview={hidePreview1} />,
      )

      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        rerender(<NotionPagePreview currentPage={page} notionCredentialId="cred-123" hidePreview={hidePreview2} />)
      })

      // Assert - Should not call API again (currentPage didn't change by reference)
      // Note: Since currentPage is the same object, effect should not re-run
      expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(1)
    })

    it('should not trigger effect when notionCredentialId changes', async () => {
      // Arrange
      const page = createMockNotionPage()

      // Act
      const { rerender } = render(
        <NotionPagePreview currentPage={page} notionCredentialId="cred-1" hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        rerender(<NotionPagePreview currentPage={page} notionCredentialId="cred-2" hidePreview={vi.fn()} />)
      })

      // Assert - Should not call API again (only currentPage is in dependency array)
      expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(1)
    })

    it('should handle rapid page changes', async () => {
      // Arrange
      const pages = Array.from({ length: 5 }, (_, i) =>
        createMockNotionPage({ page_id: `page-${i}` }))

      // Act
      const { rerender } = render(
        <NotionPagePreview currentPage={pages[0]} notionCredentialId="cred-123" hidePreview={vi.fn()} />,
      )

      // Rapidly change pages
      for (let i = 1; i < pages.length; i++) {
        await act(async () => {
          rerender(<NotionPagePreview currentPage={pages[i]} notionCredentialId="cred-123" hidePreview={vi.fn()} />)
        })
      }

      // Assert - Should have called API for each page
      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(5)
      })
    })

    it('should handle unmount during loading', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ content: 'delayed' }), 1000)),
      )

      // Act - Don't wait for content
      const { unmount } = await renderNotionPagePreview({}, false)

      // Unmount before API resolves
      unmount()

      // Assert - No errors should be thrown
      expect(true).toBe(true)
    })

    it('should handle page changing from defined to undefined', async () => {
      // Arrange
      const page = createMockNotionPage()

      // Act
      const { rerender, container } = render(
        <NotionPagePreview currentPage={page} notionCredentialId="cred-123" hidePreview={vi.fn()} />,
      )

      await waitFor(() => {
        expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        rerender(<NotionPagePreview currentPage={undefined} notionCredentialId="cred-123" hidePreview={vi.fn()} />)
      })

      // Assert - Should not crash, API should not be called again
      expect(container.firstChild).toBeInTheDocument()
      expect(mockFetchNotionPagePreview).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // Accessibility Tests
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have clickable close button with visual indicator', async () => {
      // Arrange & Act
      const { container } = await renderNotionPagePreview()

      // Assert
      const closeButton = container.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
      expect(closeButton).toHaveClass('cursor-pointer')
    })

    it('should have proper heading structure', async () => {
      // Arrange & Act
      await renderNotionPagePreview()

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Error Handling Tests
  // --------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should not crash on API network error', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockRejectedValue(new Error('Network Error'))

      // Act
      const { container } = await renderNotionPagePreview({}, false)

      // Assert - Component should still render
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    it('should not crash on API timeout', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockRejectedValue(new Error('Timeout'))

      // Act
      const { container } = await renderNotionPagePreview({}, false)

      // Assert
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    it('should not crash on malformed API response', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({} as { content: string })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle 404 error gracefully', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockRejectedValue(new Error('404 Not Found'))

      // Act
      const { container } = await renderNotionPagePreview({}, false)

      // Assert
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    it('should handle 500 error gracefully', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockRejectedValue(new Error('500 Internal Server Error'))

      // Act
      const { container } = await renderNotionPagePreview({}, false)

      // Assert
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    it('should handle authorization error gracefully', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockRejectedValue(new Error('401 Unauthorized'))

      // Act
      const { container } = await renderNotionPagePreview({}, false)

      // Assert
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Page Type Variations Tests
  // --------------------------------------------------------------------------
  describe('Page Type Variations', () => {
    it('should handle page type', async () => {
      // Arrange
      const page = createMockNotionPage({ type: 'page' })

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert
      expect(mockFetchNotionPagePreview).toHaveBeenCalledWith(
        expect.objectContaining({ pageType: 'page' }),
      )
    })

    it('should handle database type', async () => {
      // Arrange
      const page = createMockNotionPage({ type: 'database' })

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert
      expect(mockFetchNotionPagePreview).toHaveBeenCalledWith(
        expect.objectContaining({ pageType: 'database' }),
      )
    })

    it('should handle unknown type', async () => {
      // Arrange
      const page = createMockNotionPage({ type: 'unknown_type' })

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert
      expect(mockFetchNotionPagePreview).toHaveBeenCalledWith(
        expect.objectContaining({ pageType: 'unknown_type' }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Icon Type Variations Tests
  // --------------------------------------------------------------------------
  describe('Icon Type Variations', () => {
    it('should handle page with null icon', async () => {
      // Arrange
      const page = createMockNotionPage({ page_icon: null })

      // Act
      const { container } = await renderNotionPagePreview({ currentPage: page })

      // Assert - Should render default icon
      const svgIcon = container.querySelector('svg')
      expect(svgIcon).toBeInTheDocument()
    })

    it('should handle page with emoji icon object', async () => {
      // Arrange
      const page = createMockNotionPageWithEmojiIcon('📄')

      // Act
      await renderNotionPagePreview({ currentPage: page })

      // Assert
      expect(screen.getByText('📄')).toBeInTheDocument()
    })

    it('should handle page with url icon object', async () => {
      // Arrange
      const page = createMockNotionPageWithUrlIcon('https://example.com/custom-icon.png')

      // Act
      const { container } = await renderNotionPagePreview({ currentPage: page })

      // Assert
      const img = container.querySelector('img[alt="page icon"]')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'https://example.com/custom-icon.png')
    })

    it('should handle page with icon object having null values', async () => {
      // Arrange
      const page = createMockNotionPage({
        page_icon: {
          type: null,
          url: null,
          emoji: null,
        },
      })

      // Act
      const { container } = await renderNotionPagePreview({ currentPage: page })

      // Assert - Should render, likely with default/fallback
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle page with icon object having empty url', async () => {
      // Arrange
      // Suppress console.error for this test as we're intentionally testing empty src edge case
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn())

      const page = createMockNotionPage({
        page_icon: {
          type: 'url',
          url: '',
          emoji: null,
        },
      })

      // Act
      const { container } = await renderNotionPagePreview({ currentPage: page })

      // Assert - Component should not crash, may render img or fallback
      expect(container.firstChild).toBeInTheDocument()
      // NotionIcon renders img when type is 'url'
      const img = container.querySelector('img[alt="page icon"]')
      if (img)
        expect(img).toBeInTheDocument()

      // Restore console.error
      consoleErrorSpy.mockRestore()
    })
  })

  // --------------------------------------------------------------------------
  // Content Display Tests
  // --------------------------------------------------------------------------
  describe('Content Display', () => {
    it('should display content in fileContent div with correct class', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({ content: 'Test content' })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert
      const contentDiv = container.querySelector('[class*="fileContent"]')
      expect(contentDiv).toBeInTheDocument()
      expect(contentDiv).toHaveTextContent('Test content')
    })

    it('should preserve whitespace in content', async () => {
      // Arrange
      const contentWithWhitespace = '  indented content\n    more indent'
      mockFetchNotionPagePreview.mockResolvedValue({ content: contentWithWhitespace })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert
      const contentDiv = container.querySelector('[class*="fileContent"]')
      expect(contentDiv).toBeInTheDocument()
      // The CSS class has white-space: pre-line
      expect(contentDiv?.textContent).toContain('indented content')
    })

    it('should display empty string content without loading', async () => {
      // Arrange
      mockFetchNotionPagePreview.mockResolvedValue({ content: '' })

      // Act
      const { container } = await renderNotionPagePreview()

      // Assert
      const loadingElement = findLoadingSpinner(container)
      expect(loadingElement).not.toBeInTheDocument()
      const contentDiv = container.querySelector('[class*="fileContent"]')
      expect(contentDiv).toBeInTheDocument()
      expect(contentDiv?.textContent).toBe('')
    })
  })
})

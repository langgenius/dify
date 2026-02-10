import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebsitePreview from './preview'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the CSS module import - returns class names as-is
vi.mock('../file-preview/index.module.css', () => ({
  default: {
    filePreview: 'filePreview',
    previewHeader: 'previewHeader',
    title: 'title',
    previewContent: 'previewContent',
    fileContent: 'fileContent',
  },
}))

// ============================================================================
// Test Data Factory
// ============================================================================

const createPayload = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page Title',
  markdown: 'This is **markdown** content',
  description: 'A test description',
  source_url: 'https://example.com/page',
  ...overrides,
})

// ============================================================================
// WebsitePreview Component Tests
// ============================================================================

describe('WebsitePreview', () => {
  const mockHidePreview = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const payload = createPayload()

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
    })

    it('should render the page preview header text', () => {
      // Arrange
      const payload = createPayload()

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - i18n returns the key path
      expect(screen.getByText(/pagePreview/i)).toBeInTheDocument()
    })

    it('should render the payload title', () => {
      // Arrange
      const payload = createPayload({ title: 'My Custom Page' })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      expect(screen.getByText('My Custom Page')).toBeInTheDocument()
    })

    it('should render the payload source_url', () => {
      // Arrange
      const payload = createPayload({ source_url: 'https://docs.dify.ai/intro' })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      const urlElement = screen.getByText('https://docs.dify.ai/intro')
      expect(urlElement).toBeInTheDocument()
      expect(urlElement).toHaveAttribute('title', 'https://docs.dify.ai/intro')
    })

    it('should render the payload markdown content', () => {
      // Arrange
      const payload = createPayload({ markdown: 'Hello world markdown' })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      expect(screen.getByText('Hello world markdown')).toBeInTheDocument()
    })

    it('should render the close button (XMarkIcon)', () => {
      // Arrange
      const payload = createPayload()

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - the close button container is a div with cursor-pointer
      const closeButton = screen.getByText(/pagePreview/i).parentElement?.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call hidePreview when close button is clicked', () => {
      // Arrange
      const payload = createPayload()
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Act - find the close button div with cursor-pointer class
      const closeButton = screen.getByText(/pagePreview/i)
        .closest('[class*="title"]')!
        .querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)

      // Assert
      expect(mockHidePreview).toHaveBeenCalledTimes(1)
    })

    it('should call hidePreview exactly once per click', () => {
      // Arrange
      const payload = createPayload()
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Act
      const closeButton = screen.getByText(/pagePreview/i)
        .closest('[class*="title"]')!
        .querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)

      // Assert
      expect(mockHidePreview).toHaveBeenCalledTimes(2)
    })
  })

  // --------------------------------------------------------------------------
  // Props Display Tests
  // --------------------------------------------------------------------------
  describe('Props Display', () => {
    it('should display all payload fields simultaneously', () => {
      // Arrange
      const payload = createPayload({
        title: 'Full Title',
        source_url: 'https://full.example.com',
        markdown: 'Full markdown text',
      })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      expect(screen.getByText('Full Title')).toBeInTheDocument()
      expect(screen.getByText('https://full.example.com')).toBeInTheDocument()
      expect(screen.getByText('Full markdown text')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should render with empty title', () => {
      // Arrange
      const payload = createPayload({ title: '' })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - component still renders, url is visible
      expect(screen.getByText('https://example.com/page')).toBeInTheDocument()
    })

    it('should render with empty markdown', () => {
      // Arrange
      const payload = createPayload({ markdown: '' })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
    })

    it('should render with empty source_url', () => {
      // Arrange
      const payload = createPayload({ source_url: '' })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
    })

    it('should render with very long content', () => {
      // Arrange
      const longMarkdown = 'A'.repeat(5000)
      const payload = createPayload({ markdown: longMarkdown })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert
      expect(screen.getByText(longMarkdown)).toBeInTheDocument()
    })

    it('should render with special characters in title', () => {
      // Arrange
      const payload = createPayload({ title: '<script>alert("xss")</script>' })

      // Act
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - React escapes HTML by default
      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // CSS Module Classes
  // --------------------------------------------------------------------------
  describe('CSS Module Classes', () => {
    it('should apply filePreview class to root container', () => {
      // Arrange
      const payload = createPayload()

      // Act
      const { container } = render(
        <WebsitePreview payload={payload} hidePreview={mockHidePreview} />,
      )

      // Assert
      const root = container.firstElementChild
      expect(root?.className).toContain('filePreview')
      expect(root?.className).toContain('h-full')
    })
  })
})

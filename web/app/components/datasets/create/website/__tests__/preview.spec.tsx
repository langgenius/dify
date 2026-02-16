import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebsitePreview from '../preview'

// Mock Setup

// Mock the CSS module import - returns class names as-is
vi.mock('../../file-preview/index.module.css', () => ({
  default: {
    filePreview: 'filePreview',
    previewHeader: 'previewHeader',
    title: 'title',
    previewContent: 'previewContent',
    fileContent: 'fileContent',
  },
}))

// Test Data Factory

const createPayload = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page Title',
  markdown: 'This is **markdown** content',
  description: 'A test description',
  source_url: 'https://example.com/page',
  ...overrides,
})

// WebsitePreview Component Tests

describe('WebsitePreview', () => {
  const mockHidePreview = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const payload = createPayload()

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
    })

    it('should render the page preview header text', () => {
      const payload = createPayload()

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - i18n returns the key path
      expect(screen.getByText(/pagePreview/i)).toBeInTheDocument()
    })

    it('should render the payload title', () => {
      const payload = createPayload({ title: 'My Custom Page' })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      expect(screen.getByText('My Custom Page')).toBeInTheDocument()
    })

    it('should render the payload source_url', () => {
      const payload = createPayload({ source_url: 'https://docs.dify.ai/intro' })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      const urlElement = screen.getByText('https://docs.dify.ai/intro')
      expect(urlElement).toBeInTheDocument()
      expect(urlElement).toHaveAttribute('title', 'https://docs.dify.ai/intro')
    })

    it('should render the payload markdown content', () => {
      const payload = createPayload({ markdown: 'Hello world markdown' })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      expect(screen.getByText('Hello world markdown')).toBeInTheDocument()
    })

    it('should render the close button (XMarkIcon)', () => {
      const payload = createPayload()

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - the close button container is a div with cursor-pointer
      const closeButton = screen.getByText(/pagePreview/i).parentElement?.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call hidePreview when close button is clicked', () => {
      const payload = createPayload()
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Act - find the close button div with cursor-pointer class
      const closeButton = screen.getByText(/pagePreview/i)
        .closest('[class*="title"]')!
        .querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)

      expect(mockHidePreview).toHaveBeenCalledTimes(1)
    })

    it('should call hidePreview exactly once per click', () => {
      const payload = createPayload()
      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      const closeButton = screen.getByText(/pagePreview/i)
        .closest('[class*="title"]')!
        .querySelector('.cursor-pointer') as HTMLElement
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)

      expect(mockHidePreview).toHaveBeenCalledTimes(2)
    })
  })

  // Props Display Tests
  describe('Props Display', () => {
    it('should display all payload fields simultaneously', () => {
      const payload = createPayload({
        title: 'Full Title',
        source_url: 'https://full.example.com',
        markdown: 'Full markdown text',
      })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      expect(screen.getByText('Full Title')).toBeInTheDocument()
      expect(screen.getByText('https://full.example.com')).toBeInTheDocument()
      expect(screen.getByText('Full markdown text')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty title', () => {
      const payload = createPayload({ title: '' })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - component still renders, url is visible
      expect(screen.getByText('https://example.com/page')).toBeInTheDocument()
    })

    it('should render with empty markdown', () => {
      const payload = createPayload({ markdown: '' })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
    })

    it('should render with empty source_url', () => {
      const payload = createPayload({ source_url: '' })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
    })

    it('should render with very long content', () => {
      const longMarkdown = 'A'.repeat(5000)
      const payload = createPayload({ markdown: longMarkdown })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      expect(screen.getByText(longMarkdown)).toBeInTheDocument()
    })

    it('should render with special characters in title', () => {
      const payload = createPayload({ title: '<script>alert("xss")</script>' })

      render(<WebsitePreview payload={payload} hidePreview={mockHidePreview} />)

      // Assert - React escapes HTML by default
      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument()
    })
  })

  // CSS Module Classes
  describe('CSS Module Classes', () => {
    it('should apply filePreview class to root container', () => {
      const payload = createPayload()

      const { container } = render(
        <WebsitePreview payload={payload} hidePreview={mockHidePreview} />,
      )

      const root = container.firstElementChild
      expect(root?.className).toContain('filePreview')
      expect(root?.className).toContain('h-full')
    })
  })
})

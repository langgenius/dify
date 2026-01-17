import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import WebsitePreview from './web-preview'

// Uses global react-i18next mock from web/vitest.setup.ts

// Test data factory
const createMockCrawlResult = (overrides?: Partial<CrawlResultItem>): CrawlResultItem => ({
  title: 'Test Website Title',
  markdown: 'This is the **markdown** content of the website.',
  description: 'Test description',
  source_url: 'https://example.com/page',
  ...overrides,
})

const defaultProps = {
  currentWebsite: createMockCrawlResult(),
  hidePreview: vi.fn(),
}

describe('WebsitePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the component with website information', () => {
      render(<WebsitePreview {...defaultProps} />)

      // i18n mock returns key by default
      expect(screen.getByText('datasetPipeline.addDocuments.stepOne.preview')).toBeInTheDocument()
      expect(screen.getByText('Test Website Title')).toBeInTheDocument()
    })

    it('should display the source URL', () => {
      render(<WebsitePreview {...defaultProps} />)

      expect(screen.getByText('https://example.com/page')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<WebsitePreview {...defaultProps} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render the markdown content', () => {
      render(<WebsitePreview {...defaultProps} />)

      expect(screen.getByText('This is the **markdown** content of the website.')).toBeInTheDocument()
    })
  })

  describe('Character Count', () => {
    it('should display character count for small content', () => {
      const currentWebsite = createMockCrawlResult({ markdown: 'Hello' }) // 5 characters

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      // Real formatNumberAbbreviated returns "5" for numbers < 1000
      expect(screen.getByText(/5/)).toBeInTheDocument()
    })

    it('should format character count in thousands', () => {
      const longContent = 'a'.repeat(2500)
      const currentWebsite = createMockCrawlResult({ markdown: longContent })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      // Real formatNumberAbbreviated uses lowercase 'k': "2.5k"
      expect(screen.getByText(/2\.5k/)).toBeInTheDocument()
    })

    it('should format character count in millions', () => {
      const veryLongContent = 'a'.repeat(1500000)
      const currentWebsite = createMockCrawlResult({ markdown: veryLongContent })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByText(/1\.5M/)).toBeInTheDocument()
    })

    it('should show 0 characters for empty markdown', () => {
      const currentWebsite = createMockCrawlResult({ markdown: '' })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByText(/0/)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call hidePreview when close button is clicked', () => {
      const hidePreview = vi.fn()

      render(<WebsitePreview {...defaultProps} hidePreview={hidePreview} />)

      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      expect(hidePreview).toHaveBeenCalledTimes(1)
    })
  })

  describe('URL Display', () => {
    it('should display long URLs', () => {
      const longUrl = 'https://example.com/very/long/path/to/page/with/many/segments'
      const currentWebsite = createMockCrawlResult({ source_url: longUrl })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      const urlElement = screen.getByTitle(longUrl)
      expect(urlElement).toBeInTheDocument()
      expect(urlElement).toHaveTextContent(longUrl)
    })

    it('should display URL with title attribute', () => {
      const currentWebsite = createMockCrawlResult({ source_url: 'https://test.com' })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByTitle('https://test.com')).toBeInTheDocument()
    })
  })

  describe('Content Display', () => {
    it('should display the markdown content in content area', () => {
      const currentWebsite = createMockCrawlResult({
        markdown: 'Content with **bold** and *italic* text.',
      })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByText('Content with **bold** and *italic* text.')).toBeInTheDocument()
    })

    it('should handle multiline content', () => {
      const multilineContent = 'Line 1\nLine 2\nLine 3'
      const currentWebsite = createMockCrawlResult({ markdown: multilineContent })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      // Multiline content is rendered as-is
      expect(screen.getByText((content) => {
        return content.includes('Line 1') && content.includes('Line 2') && content.includes('Line 3')
      })).toBeInTheDocument()
    })

    it('should handle special characters in content', () => {
      const specialContent = '<script>alert("xss")</script> & < > " \''
      const currentWebsite = createMockCrawlResult({ markdown: specialContent })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByText(specialContent)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty title', () => {
      const currentWebsite = createMockCrawlResult({ title: '' })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle empty source URL', () => {
      const currentWebsite = createMockCrawlResult({ source_url: '' })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle very long title', () => {
      const longTitle = 'A'.repeat(500)
      const currentWebsite = createMockCrawlResult({ title: longTitle })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should handle unicode characters in content', () => {
      const unicodeContent = '你好世界 🌍 مرحبا こんにちは'
      const currentWebsite = createMockCrawlResult({ markdown: unicodeContent })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByText(unicodeContent)).toBeInTheDocument()
    })

    it('should handle URL with query parameters', () => {
      const urlWithParams = 'https://example.com/page?query=test&param=value'
      const currentWebsite = createMockCrawlResult({ source_url: urlWithParams })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByTitle(urlWithParams)).toBeInTheDocument()
    })

    it('should handle URL with hash fragment', () => {
      const urlWithHash = 'https://example.com/page#section-1'
      const currentWebsite = createMockCrawlResult({ source_url: urlWithHash })

      render(<WebsitePreview {...defaultProps} currentWebsite={currentWebsite} />)

      expect(screen.getByTitle(urlWithHash)).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should apply container styles', () => {
      const { container } = render(<WebsitePreview {...defaultProps} />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('flex', 'h-full', 'w-full', 'flex-col')
    })
  })

  describe('Multiple Renders', () => {
    it('should update when currentWebsite changes', () => {
      const website1 = createMockCrawlResult({ title: 'Website 1', markdown: 'Content 1' })
      const website2 = createMockCrawlResult({ title: 'Website 2', markdown: 'Content 2' })

      const { rerender } = render(<WebsitePreview {...defaultProps} currentWebsite={website1} />)

      expect(screen.getByText('Website 1')).toBeInTheDocument()
      expect(screen.getByText('Content 1')).toBeInTheDocument()

      rerender(<WebsitePreview {...defaultProps} currentWebsite={website2} />)

      expect(screen.getByText('Website 2')).toBeInTheDocument()
      expect(screen.getByText('Content 2')).toBeInTheDocument()
    })

    it('should call new hidePreview when prop changes', () => {
      const hidePreview1 = vi.fn()
      const hidePreview2 = vi.fn()

      const { rerender } = render(<WebsitePreview {...defaultProps} hidePreview={hidePreview1} />)

      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)
      expect(hidePreview1).toHaveBeenCalledTimes(1)

      rerender(<WebsitePreview {...defaultProps} hidePreview={hidePreview2} />)

      fireEvent.click(closeButton)
      expect(hidePreview2).toHaveBeenCalledTimes(1)
      expect(hidePreview1).toHaveBeenCalledTimes(1)
    })
  })
})

import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Component Import (after mocks)
// ============================================================================

import FireCrawl from './index'

// ============================================================================
// Mock Setup - Only mock API calls and context
// ============================================================================

// Mock API service
const mockCreateFirecrawlTask = vi.fn()
const mockCheckFirecrawlTaskStatus = vi.fn()

vi.mock('@/service/datasets', () => ({
  createFirecrawlTask: (...args: unknown[]) => mockCreateFirecrawlTask(...args),
  checkFirecrawlTaskStatus: (...args: unknown[]) => mockCheckFirecrawlTaskStatus(...args),
}))

// Mock modal context
const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: vi.fn(() => mockSetShowAccountSettingModal),
}))

// Mock sleep utility to speed up tests
vi.mock('@/utils', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}))

// Mock useDocLink hook for UrlInput placeholder
vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => () => 'https://docs.example.com'),
}))

// ============================================================================
// Test Data Factory
// ============================================================================

const createMockCrawlOptions = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({
  crawl_sub_pages: true,
  limit: 10,
  max_depth: 2,
  excludes: '',
  includes: '',
  only_main_content: false,
  use_sitemap: false,
  ...overrides,
})

const createMockCrawlResultItem = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page',
  markdown: '# Test Content',
  description: 'Test page description',
  source_url: 'https://example.com/page',
  ...overrides,
})

// ============================================================================
// FireCrawl Component Tests
// ============================================================================

describe('FireCrawl', () => {
  const mockOnPreview = vi.fn()
  const mockOnCheckedCrawlResultChange = vi.fn()
  const mockOnJobIdChange = vi.fn()
  const mockOnCrawlOptionsChange = vi.fn()

  const defaultProps = {
    onPreview: mockOnPreview,
    checkedCrawlResult: [] as CrawlResultItem[],
    onCheckedCrawlResultChange: mockOnCheckedCrawlResultChange,
    onJobIdChange: mockOnJobIdChange,
    crawlOptions: createMockCrawlOptions(),
    onCrawlOptionsChange: mockOnCrawlOptionsChange,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateFirecrawlTask.mockReset()
    mockCheckFirecrawlTaskStatus.mockReset()
  })

  // Helper to get URL input (first textbox with specific placeholder)
  const getUrlInput = () => {
    return screen.getByPlaceholderText('https://docs.example.com')
  }

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<FireCrawl {...defaultProps} />)

      expect(screen.getByText(/firecrawlTitle/i)).toBeInTheDocument()
    })

    it('should render Header component with correct props', () => {
      render(<FireCrawl {...defaultProps} />)

      expect(screen.getByText(/firecrawlTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/configureFirecrawl/i)).toBeInTheDocument()
      expect(screen.getByText(/firecrawlDoc/i)).toBeInTheDocument()
    })

    it('should render UrlInput component', () => {
      render(<FireCrawl {...defaultProps} />)

      expect(getUrlInput()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument()
    })

    it('should render Options component', () => {
      render(<FireCrawl {...defaultProps} />)

      expect(screen.getByText(/crawlSubPage/i)).toBeInTheDocument()
      expect(screen.getByText(/limit/i)).toBeInTheDocument()
    })

    it('should not render crawling or result components initially', () => {
      render(<FireCrawl {...defaultProps} />)

      // Crawling and result components should not be visible in init state
      expect(screen.queryByText(/crawling/i)).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Configuration Button Tests
  // --------------------------------------------------------------------------
  describe('Configuration Button', () => {
    it('should call setShowAccountSettingModal when configure button is clicked', async () => {
      const user = userEvent.setup()
      render(<FireCrawl {...defaultProps} />)

      const configButton = screen.getByText(/configureFirecrawl/i)
      await user.click(configButton)

      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: 'data-source',
      })
    })
  })

  // --------------------------------------------------------------------------
  // URL Validation Tests
  // --------------------------------------------------------------------------
  describe('URL Validation', () => {
    it('should show error toast when URL is empty', async () => {
      const user = userEvent.setup()
      render(<FireCrawl {...defaultProps} />)

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      // Should not call API when validation fails
      expect(mockCreateFirecrawlTask).not.toHaveBeenCalled()
    })

    it('should show error toast when URL does not start with http:// or https://', async () => {
      const user = userEvent.setup()
      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'invalid-url.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      // Should not call API when validation fails
      expect(mockCreateFirecrawlTask).not.toHaveBeenCalled()
    })

    it('should show error toast when limit is empty', async () => {
      const user = userEvent.setup()
      const propsWithEmptyLimit = {
        ...defaultProps,
        crawlOptions: createMockCrawlOptions({ limit: '' as unknown as number }),
      }
      render(<FireCrawl {...propsWithEmptyLimit} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      // Should not call API when validation fails
      expect(mockCreateFirecrawlTask).not.toHaveBeenCalled()
    })

    it('should show error toast when limit is null', async () => {
      const user = userEvent.setup()
      const propsWithNullLimit = {
        ...defaultProps,
        crawlOptions: createMockCrawlOptions({ limit: null as unknown as number }),
      }
      render(<FireCrawl {...propsWithNullLimit} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      expect(mockCreateFirecrawlTask).not.toHaveBeenCalled()
    })

    it('should accept valid http:// URL', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job-id' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: [],
        total: 0,
        current: 0,
        time_consuming: 1,
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'http://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockCreateFirecrawlTask).toHaveBeenCalled()
      })
    })

    it('should accept valid https:// URL', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job-id' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: [],
        total: 0,
        current: 0,
        time_consuming: 1,
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockCreateFirecrawlTask).toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Crawl Execution Tests
  // --------------------------------------------------------------------------
  describe('Crawl Execution', () => {
    it('should call createFirecrawlTask with correct parameters', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job-id' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: [],
        total: 0,
        current: 0,
        time_consuming: 1,
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockCreateFirecrawlTask).toHaveBeenCalledWith({
          url: 'https://example.com',
          options: expect.objectContaining({
            crawl_sub_pages: true,
            limit: 10,
            max_depth: 2,
          }),
        })
      })
    })

    it('should call onJobIdChange with job_id from API response', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'my-job-123' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: [],
        total: 0,
        current: 0,
        time_consuming: 1,
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockOnJobIdChange).toHaveBeenCalledWith('my-job-123')
      })
    })

    it('should remove empty max_depth from crawlOptions before sending to API', async () => {
      const user = userEvent.setup()
      const propsWithEmptyMaxDepth = {
        ...defaultProps,
        crawlOptions: createMockCrawlOptions({ max_depth: '' as unknown as number }),
      }
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job-id' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: [],
        total: 0,
        current: 0,
        time_consuming: 1,
      })

      render(<FireCrawl {...propsWithEmptyMaxDepth} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockCreateFirecrawlTask).toHaveBeenCalledWith({
          url: 'https://example.com',
          options: expect.not.objectContaining({
            max_depth: '',
          }),
        })
      })
    })

    it('should show loading state while running', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      // Button should show loading state (no longer show "run" text)
      await waitFor(() => {
        expect(runButton).not.toHaveTextContent(/run/i)
      })
    })
  })

  // --------------------------------------------------------------------------
  // Crawl Status Polling Tests
  // --------------------------------------------------------------------------
  describe('Crawl Status Polling', () => {
    it('should handle completed status', async () => {
      const user = userEvent.setup()
      const mockResults = [createMockCrawlResultItem()]
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: mockResults,
        total: 1,
        current: 1,
        time_consuming: 2.5,
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockOnCheckedCrawlResultChange).toHaveBeenCalledWith(mockResults)
      })
    })

    it('should handle error status from API', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'error',
        message: 'Crawl failed',
        data: [],
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText(/exceptionErrorTitle/i)).toBeInTheDocument()
      })
    })

    it('should handle missing status as error', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: undefined,
        message: 'No status',
        data: [],
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText(/exceptionErrorTitle/i)).toBeInTheDocument()
      })
    })

    it('should poll again when status is pending', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus
        .mockResolvedValueOnce({
          status: 'pending',
          data: [{ title: 'Page 1', markdown: 'content', source_url: 'https://example.com/1' }],
          total: 5,
          current: 1,
        })
        .mockResolvedValueOnce({
          status: 'completed',
          data: [{ title: 'Page 1', markdown: 'content', source_url: 'https://example.com/1' }],
          total: 5,
          current: 5,
          time_consuming: 3,
        })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockCheckFirecrawlTaskStatus).toHaveBeenCalledTimes(2)
      })
    })

    it('should update progress during crawling', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus
        .mockResolvedValueOnce({
          status: 'pending',
          data: [{ title: 'Page 1', markdown: 'content', source_url: 'https://example.com/1' }],
          total: 10,
          current: 3,
        })
        .mockResolvedValueOnce({
          status: 'completed',
          data: [{ title: 'Page 1', markdown: 'content', source_url: 'https://example.com/1' }],
          total: 10,
          current: 10,
          time_consuming: 5,
        })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(mockOnCheckedCrawlResultChange).toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Error Handling Tests
  // --------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should handle API exception during task creation', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockRejectedValueOnce(new Error('Network error'))

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText(/exceptionErrorTitle/i)).toBeInTheDocument()
      })
    })

    it('should handle API exception during status check', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockRejectedValueOnce({
        json: () => Promise.resolve({ message: 'Status check failed' }),
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText(/exceptionErrorTitle/i)).toBeInTheDocument()
      })
    })

    it('should display error message from API', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'error',
        message: 'Custom error message',
        data: [],
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText('Custom error message')).toBeInTheDocument()
      })
    })

    it('should display unknown error when no error message provided', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'error',
        message: undefined,
        data: [],
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText(/unknownError/i)).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Options Change Tests
  // --------------------------------------------------------------------------
  describe('Options Change', () => {
    it('should call onCrawlOptionsChange when options change', () => {
      render(<FireCrawl {...defaultProps} />)

      // Find and change limit input
      const limitInput = screen.getByDisplayValue('10')
      fireEvent.change(limitInput, { target: { value: '20' } })

      expect(mockOnCrawlOptionsChange).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 }),
      )
    })

    it('should call onCrawlOptionsChange when checkbox changes', () => {
      const { container } = render(<FireCrawl {...defaultProps} />)

      // Use data-testid to find checkboxes since they are custom div elements
      const checkboxes = container.querySelectorAll('[data-testid^="checkbox-"]')
      fireEvent.click(checkboxes[0]) // crawl_sub_pages

      expect(mockOnCrawlOptionsChange).toHaveBeenCalledWith(
        expect.objectContaining({ crawl_sub_pages: false }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Crawled Result Display Tests
  // --------------------------------------------------------------------------
  describe('Crawled Result Display', () => {
    it('should display CrawledResult when crawl is finished successfully', async () => {
      const user = userEvent.setup()
      const mockResults = [
        createMockCrawlResultItem({ title: 'Result Page 1' }),
        createMockCrawlResultItem({ title: 'Result Page 2' }),
      ]
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: mockResults,
        total: 2,
        current: 2,
        time_consuming: 1.5,
      })

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText('Result Page 1')).toBeInTheDocument()
        expect(screen.getByText('Result Page 2')).toBeInTheDocument()
      })
    })

    it('should limit total to crawlOptions.limit', async () => {
      const user = userEvent.setup()
      const propsWithLimit5 = {
        ...defaultProps,
        crawlOptions: createMockCrawlOptions({ limit: 5 }),
      }
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockResolvedValueOnce({
        status: 'completed',
        data: [],
        total: 100, // API returns more than limit
        current: 5,
        time_consuming: 1,
      })

      render(<FireCrawl {...propsWithLimit5} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        // Total should be capped to limit (5)
        expect(mockCheckFirecrawlTaskStatus).toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<FireCrawl {...defaultProps} />)

      rerender(<FireCrawl {...defaultProps} />)

      expect(screen.getByText(/firecrawlTitle/i)).toBeInTheDocument()
    })
  })
})

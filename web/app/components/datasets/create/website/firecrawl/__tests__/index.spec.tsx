import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import {
  act,
  fireEvent,
  render as renderWithoutUrlState,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createHttpError } from '@/service/http-error'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { sleep } from '@/utils'
// Component Import (after mocks)
import FireCrawl from '../index'

// Mock Setup - Only mock API calls and context

// Mock API service
const mockCreateFirecrawlTask = vi.fn()
const mockCheckFirecrawlTaskStatus = vi.fn()
const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/service/datasets', () => ({
  createFirecrawlTask: (...args: unknown[]) => mockCreateFirecrawlTask(...args),
  checkFirecrawlTaskStatus: (...args: unknown[]) => mockCheckFirecrawlTaskStatus(...args),
}))

// Mock sleep utility to speed up tests
vi.mock('@/utils', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}))

// Mock useDocLink hook for UrlInput placeholder
vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => () => 'https://docs.example.com'),
}))

// Test Data Factory

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

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return {
    promise,
    resolve,
    reject,
  }
}

// FireCrawl Component Tests

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

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
    vi.mocked(sleep).mockImplementation(() => Promise.resolve())
  })

  // Helper to get URL input (first textbox with specific placeholder)
  const getUrlInput = () => {
    return screen.getByPlaceholderText('https://docs.example.com')
  }

  // Configuration Button Tests
  describe('Configuration Button', () => {
    it('should navigate to data source settings when configure button is clicked', async () => {
      const user = userEvent.setup()
      render(<FireCrawl {...defaultProps} />)

      const configButton = screen.getByText(/configureFirecrawl/i)
      await user.click(configButton)

      await waitFor(() =>
        expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
      )
      expect(mockRouterPush).not.toHaveBeenCalled()
    })
  })

  // URL Validation Tests
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
        crawlOptions: createMockCrawlOptions({ limit: '' }),
      }
      render(<FireCrawl {...propsWithEmptyLimit} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      // Should not call API when validation fails
      expect(mockCreateFirecrawlTask).not.toHaveBeenCalled()
    })

    it('accepts an http URL and selects the returned results', async () => {
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
        expect(mockOnCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })
  })

  // Crawl Execution Tests
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
        expect(mockOnJobIdChange).toHaveBeenCalledWith('test-job-id')
        expect(mockCheckFirecrawlTaskStatus).toHaveBeenCalledWith('test-job-id')
        expect(mockCreateFirecrawlTask).toHaveBeenCalledWith({
          url: 'https://example.com',
          options: createMockCrawlOptions(),
        })
      })

      await waitFor(() => {
        expect(mockOnCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should remove empty max_depth from crawlOptions before sending to API', async () => {
      const user = userEvent.setup()
      const propsWithEmptyMaxDepth = {
        ...defaultProps,
        crawlOptions: createMockCrawlOptions({ max_depth: '' }),
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

      await waitFor(() => {
        expect(mockOnCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should show loading state while running', async () => {
      const user = userEvent.setup()
      const createTaskDeferred = createDeferred<{ job_id: string }>()
      mockCreateFirecrawlTask.mockImplementation(() => createTaskDeferred.promise)
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
        expect(runButton).toHaveAccessibleName(/run/i)
        expect(runButton).toHaveAttribute('aria-disabled', 'true')
        expect(runButton).toHaveFocus()
      })

      await user.click(runButton)
      expect(mockCreateFirecrawlTask).toHaveBeenCalledTimes(1)
      await act(async () => {
        createTaskDeferred.resolve({ job_id: 'test-job-id' })
      })

      await waitFor(() => {
        expect(mockOnCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })
  })

  // Crawl Status Polling Tests
  describe('Crawl Status Polling', () => {
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
        expect(screen.getByText(/exceptionErrorTitle/i))!.toBeInTheDocument()
      })
    })

    it('shows capped progress before polling the same job to completion', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      const pollDelay = createDeferred<void>()
      vi.mocked(sleep).mockReturnValueOnce(pollDelay.promise)
      mockCheckFirecrawlTaskStatus
        .mockResolvedValueOnce({
          status: 'pending',
          data: [{ title: 'Page 1', markdown: 'content', source_url: 'https://example.com/1' }],
          total: 100,
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

      expect(await screen.findByText(/totalPageScraped/)).toHaveTextContent('1/10')
      expect(mockCheckFirecrawlTaskStatus).toHaveBeenCalledTimes(1)
      await act(async () => pollDelay.resolve())
      await waitFor(() => expect(mockCheckFirecrawlTaskStatus).toHaveBeenCalledTimes(2))
      expect(mockCheckFirecrawlTaskStatus).toHaveBeenNthCalledWith(2, 'test-job')
      expect(await screen.findByText('Page 1')).toBeInTheDocument()
    })
  })

  // Error Handling Tests
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
        expect(screen.getByText(/exceptionErrorTitle/i))!.toBeInTheDocument()
      })
    })

    it('should handle API exception during status check', async () => {
      const user = userEvent.setup()
      mockCreateFirecrawlTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckFirecrawlTaskStatus.mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 502 }), { message: 'Status check failed' }),
      )

      render(<FireCrawl {...defaultProps} />)

      const input = getUrlInput()
      await user.type(input, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await user.click(runButton)

      await waitFor(() => {
        expect(screen.getByText(/exceptionErrorTitle/i))!.toBeInTheDocument()
      })
      expect(screen.getByText('Status check failed')).toBeInTheDocument()
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
        expect(screen.getByText('Custom error message'))!.toBeInTheDocument()
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
        expect(screen.getByText(/unknownError/i))!.toBeInTheDocument()
      })
    })
  })

  // Options Change Tests
  describe('Options Change', () => {
    it('should call onCrawlOptionsChange when options change', () => {
      render(<FireCrawl {...defaultProps} />)

      // Find and change limit input
      const limitInput = screen.getByDisplayValue('10')
      fireEvent.change(limitInput, { target: { value: '20' } })

      expect(mockOnCrawlOptionsChange).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
    })

    it('should call onCrawlOptionsChange when checkbox changes', async () => {
      const user = userEvent.setup()
      render(<FireCrawl {...defaultProps} />)

      await user.click(screen.getByRole('checkbox', { name: /crawlSubPage/ }))

      expect(mockOnCrawlOptionsChange).toHaveBeenCalledWith(
        expect.objectContaining({ crawl_sub_pages: false }),
      )
    })
  })

  // Crawled Result Display Tests
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
        expect(mockOnCheckedCrawlResultChange).toHaveBeenLastCalledWith(mockResults)
        expect(screen.getByText('Result Page 1'))!.toBeInTheDocument()
        expect(screen.getByText('Result Page 2'))!.toBeInTheDocument()
      })
    })
  })
})

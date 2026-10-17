import type { Mock } from 'vite-plus/test'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { act, render as renderWithoutUrlState, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { checkWatercrawlTaskStatus, createWatercrawlTask } from '@/service/datasets'
import { createHttpError } from '@/service/http-error'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { sleep } from '@/utils'
import WaterCrawl from '../index'

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/service/datasets', () => ({
  createWatercrawlTask: vi.fn(),
  checkWatercrawlTaskStatus: vi.fn(),
}))

vi.mock('@/utils', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}))

// Mock i18n context
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) =>
    path ? `https://docs.dify.ai/en${path}` : 'https://docs.dify.ai/en/',
}))

// Note: limit and max_depth are typed as `number | string` in CrawlOptions
// Tests may use number, string, or empty string values to cover all valid cases
const createDefaultCrawlOptions = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({
  crawl_sub_pages: true,
  only_main_content: true,
  includes: '',
  excludes: '',
  limit: 10,
  max_depth: 2,
  use_sitemap: false,
  ...overrides,
})

const createCrawlResultItem = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page Title',
  markdown: '# Test Content\n\nThis is test markdown content.',
  description: 'Test description',
  source_url: 'https://example.com/page',
  ...overrides,
})

const createDefaultProps = (overrides: Partial<Parameters<typeof WaterCrawl>[0]> = {}) => ({
  onPreview: vi.fn(),
  checkedCrawlResult: [] as CrawlResultItem[],
  onCheckedCrawlResultChange: vi.fn(),
  onJobIdChange: vi.fn(),
  crawlOptions: createDefaultCrawlOptions(),
  onCrawlOptionsChange: vi.fn(),
  ...overrides,
})

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

describe('WaterCrawl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createWatercrawlTask).mockReset()
    vi.mocked(checkWatercrawlTaskStatus).mockReset()
    vi.mocked(sleep).mockReset().mockResolvedValue(undefined)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  // Tests for initial component rendering
  describe('Rendering', () => {
    it('should render doc link to WaterCrawl', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      const docLink = screen.getByRole('link')
      expect(docLink)!.toHaveAttribute('href', 'https://docs.watercrawl.dev/')
    })
  })

  describe('Props', () => {
    it('should call onCrawlOptionsChange when options change', async () => {
      const user = userEvent.setup()
      const onCrawlOptionsChange = vi.fn()
      const props = createDefaultProps({ onCrawlOptionsChange })

      render(<WaterCrawl {...props} />)

      // Find the limit input by its associated label text
      const limitLabel = screen.queryByText('datasetCreation.stepOne.website.limit')

      if (limitLabel) {
        // The limit input is a number input (spinbutton role) within the same container
        const limitInput = limitLabel
          .closest('div')
          ?.parentElement?.querySelector('input[type="number"]')

        if (limitInput) {
          await user.clear(limitInput)
          await user.type(limitInput, '20')

          expect(onCrawlOptionsChange).toHaveBeenCalled()
        }
      } else {
        // Options might not be visible, just verify component renders
        expect(screen.getByText('datasetCreation.stepOne.website.options'))!.toBeInTheDocument()
      }
    })
  })

  describe('State Management', () => {
    it('should transition from init to running state when run is clicked', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      let resolvePromise: () => void
      mockCreateTask.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () => resolve({ job_id: 'test-job' })
          }),
      )

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const urlInput = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(urlInput, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(runButton)

      // Assert - crawling indicator should appear
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped/i))!.toBeInTheDocument()
      })

      // Cleanup - resolve the promise
      resolvePromise!()
    })

    it('should fold options when step changes from init', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      // Options should be visible initially
      expect(screen.getByText('datasetCreation.stepOne.website.crawlSubPage'))!.toBeInTheDocument()

      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - options should be folded after crawl starts
      await waitFor(() => {
        expect(
          screen.queryByText('datasetCreation.stepOne.website.crawlSubPage'),
        ).not.toBeInTheDocument()
      })
    })
  })

  // Side Effects and Cleanup Tests

  // Callback Stability and Memoization Tests

  // User Interactions and Event Handlers Tests
  describe('User Interactions', () => {
    it('should open account settings when configuration button is clicked', async () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const configButton = screen.getByText('datasetCreation.stepOne.website.configureWatercrawl')
      await userEvent.click(configButton)

      await waitFor(() =>
        expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
      )
      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('should handle checkbox changes in options', async () => {
      const onCrawlOptionsChange = vi.fn()
      const props = createDefaultProps({
        onCrawlOptionsChange,
        crawlOptions: createDefaultCrawlOptions({ crawl_sub_pages: false }),
      })

      render(<WaterCrawl {...props} />)

      const checkbox = screen.getByRole('checkbox', { name: /crawlSubPage/ })
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(checkbox)

      expect(onCrawlOptionsChange).toHaveBeenCalled()
    })

    it('should toggle options visibility when clicking options header', async () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      // Options content should be visible initially
      expect(screen.getByText('datasetCreation.stepOne.website.crawlSubPage'))!.toBeInTheDocument()

      const optionsHeader = screen.getByText('datasetCreation.stepOne.website.options')
      await userEvent.click(optionsHeader)

      // Assert - options should be hidden
      expect(
        screen.queryByText('datasetCreation.stepOne.website.crawlSubPage'),
      ).not.toBeInTheDocument()

      await userEvent.click(optionsHeader)

      // Options should be visible again
      expect(screen.getByText('datasetCreation.stepOne.website.crawlSubPage'))!.toBeInTheDocument()
    })
  })

  // API Calls Tests
  describe('API Calls', () => {
    it('should call createWatercrawlTask with correct parameters', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'api-test-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const crawlOptions = createDefaultCrawlOptions({
        limit: 5,
        max_depth: 3,
        crawl_sub_pages: false,
        use_sitemap: true,
        only_main_content: false,
        includes: '/docs/*',
        excludes: '/api/*',
      })
      const props = createDefaultProps({ crawlOptions })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://api-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith({
          url: 'https://api-test.com',
          options: crawlOptions,
        })
      })
    })

    it('should delete max_depth from options when it is empty string', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const crawlOptions = createDefaultCrawlOptions({ max_depth: '' })
      const props = createDefaultProps({ crawlOptions })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - max_depth should be deleted from the request
      await waitFor(() => {
        const callArgs = mockCreateTask.mock.calls[0]![0]
        expect(callArgs.options).not.toHaveProperty('max_depth')
      })
    })

    it('should handle error status from polling', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'fail-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'error',
        message: 'Crawl failed due to network error',
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://fail-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle'),
        )!.toBeInTheDocument()
      })

      expect(screen.getByText('Crawl failed due to network error'))!.toBeInTheDocument()
    })

    it('should handle API error during status check', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'error-job' })
      mockCheckStatus.mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 502 }), { message: 'API Error occurred' }),
      )

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://error-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle'),
        )!.toBeInTheDocument()
      })
      expect(screen.getByText('API Error occurred')).toBeInTheDocument()
    })

    it('caps displayed progress at the configured limit while polling', async () => {
      let resume!: () => void
      vi.mocked(sleep).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resume = resolve
          }),
      )
      vi.mocked(createWatercrawlTask).mockResolvedValueOnce({ job_id: 'limit-job' })
      vi.mocked(checkWatercrawlTaskStatus)
        .mockResolvedValueOnce({ status: 'running', current: 1, total: 100, data: [] })
        .mockResolvedValueOnce({
          status: 'completed',
          current: 1,
          total: 100,
          data: [createCrawlResultItem()],
        })
      const props = createDefaultProps({ crawlOptions: createDefaultCrawlOptions({ limit: 5 }) })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<WaterCrawl {...props} />)
      await user.type(
        screen.getByPlaceholderText('https://docs.dify.ai/en/'),
        'https://example.com',
      )
      await user.click(screen.getByRole('button', { name: /run/i }))
      await waitFor(() => expect(screen.getByText(/totalPageScraped/)).toHaveTextContent('1/5'))
      expect(checkWatercrawlTaskStatus).toHaveBeenCalledExactlyOnceWith('limit-job')
      await act(async () => resume())
      await screen.findByText('Test Page Title')
      expect(props.onCheckedCrawlResultChange).toHaveBeenLastCalledWith([createCrawlResultItem()])
    })

    it('should handle response without status field as error', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'no-status-job' })
      mockCheckStatus.mockResolvedValueOnce({
        // No status field
        message: 'Unknown error',
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://no-status-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle'),
        )!.toBeInTheDocument()
      })
    })
  })

  // Edge Cases and Error Handling Tests
  describe('Edge Cases and Error Handling', () => {
    it('should show error for empty URL', async () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - Toast should be shown (mocked via Toast component)
      await waitFor(() => {
        expect(createWatercrawlTask).not.toHaveBeenCalled()
      })
    })

    it('should show error for invalid URL format', async () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'invalid-url')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(createWatercrawlTask).not.toHaveBeenCalled()
      })
    })

    it('should show error for URL without protocol', async () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(createWatercrawlTask).not.toHaveBeenCalled()
      })
    })

    it('should accept URL with http:// protocol', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'http-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'http://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalled()
      })
    })

    it('should show error when limit is empty', async () => {
      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: '' }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(createWatercrawlTask).not.toHaveBeenCalled()
      })
    })

    it('should handle API throwing an exception', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      mockCreateTask.mockRejectedValueOnce(new Error('Network error'))
      // Suppress console output during test to avoid noisy logs
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(vi.fn())

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://exception-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle'),
        )!.toBeInTheDocument()
      })

      consoleSpy.mockRestore()
    })

    it('should show unknown error when error message is empty', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'empty-error-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'error',
        // No message
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://empty-error-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.unknownError'),
        )!.toBeInTheDocument()
      })
    })

    it('should handle empty data array from API', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'empty-data-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 0,
        total: 0,
        data: [],
      })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://empty-data-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should handle null data from running status', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'null-data-job' })
      mockCheckStatus
        .mockResolvedValueOnce({
          status: 'running',
          current: 0,
          total: 5,
          data: null,
        })
        .mockResolvedValueOnce({
          status: 'completed',
          current: 5,
          total: 5,
          data: [createCrawlResultItem()],
        })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://null-data-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should handle undefined data from completed job polling', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'undefined-data-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 0,
        total: 0,
        // data is undefined - triggers || [] fallback
      })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://undefined-data-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should handle crawlResult with zero current value', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'zero-current-job' })
      mockCheckStatus.mockImplementation(
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      )

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 10 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://zero-current-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should show 0/10 in crawling indicator
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/10/))!.toBeInTheDocument()
      })
    })

    it('should handle crawlResult with zero total and empty limit', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'zero-total-job' })
      mockCheckStatus.mockImplementation(
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      )

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: '0' }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://zero-total-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should show 0/0
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/0/))!.toBeInTheDocument()
      })
    })

    it('should handle crawlResult with current=0 and total=0 during running', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'both-zero-job' })
      mockCheckStatus
        .mockResolvedValueOnce({
          status: 'running',
          current: 0,
          total: 0,
          data: [],
        })
        .mockImplementationOnce(
          () =>
            new Promise(() => {
              /* never resolves */
            }),
        )

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 5 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://both-zero-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped/)).toHaveTextContent('0/5')
      })
    })
  })

  // Display and UI State Tests
  describe('Display and UI States', () => {
    it('should display time consumed after crawl completion', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'time-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        time_consuming: 2.5,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://time.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText(/scrapTimeInfo/i))!.toBeInTheDocument()
      })
    })
  })

  describe('Integration', () => {
    it('should complete full crawl workflow with job polling', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()
      const onJobIdChange = vi.fn()
      const onPreview = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'full-workflow-job' })
      mockCheckStatus
        .mockResolvedValueOnce({
          status: 'running',
          current: 2,
          total: 5,
          data: [
            createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
            createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
          ],
        })
        .mockResolvedValueOnce({
          status: 'completed',
          current: 5,
          total: 5,
          time_consuming: 3.5,
          data: [
            createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
            createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
            createCrawlResultItem({ source_url: 'https://page3.com', title: 'Page 3' }),
            createCrawlResultItem({ source_url: 'https://page4.com', title: 'Page 4' }),
            createCrawlResultItem({ source_url: 'https://page5.com', title: 'Page 5' }),
          ],
        })

      const props = createDefaultProps({
        onCheckedCrawlResultChange,
        onJobIdChange,
        onPreview,
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://full-workflow.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - job id should be set
      await waitFor(() => {
        expect(onJobIdChange).toHaveBeenCalledWith('full-workflow-job')
      })

      // Assert - final results should be displayed
      await waitFor(() => {
        expect(screen.getByText('Page 1'))!.toBeInTheDocument()
        expect(screen.getByText('Page 5'))!.toBeInTheDocument()
      })

      expect(mockCreateTask).toHaveBeenCalledExactlyOnceWith({
        url: 'https://full-workflow.com',
        options: props.crawlOptions,
      })
      expect(mockCheckStatus).toHaveBeenCalledTimes(2)
      expect(mockCheckStatus).toHaveBeenNthCalledWith(1, 'full-workflow-job')
      expect(mockCheckStatus).toHaveBeenNthCalledWith(2, 'full-workflow-job')
      // Assert - checked results should be updated
      expect(onCheckedCrawlResultChange).toHaveBeenLastCalledWith(
        [1, 2, 3, 4, 5].map((index) =>
          createCrawlResultItem({ source_url: `https://page${index}.com`, title: `Page ${index}` }),
        ),
      )
    })

    it('should handle complete workflow from input to preview', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onPreview = vi.fn()
      const onCheckedCrawlResultChange = vi.fn()
      const onJobIdChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'preview-workflow-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        time_consuming: 1.2,
        data: [
          createCrawlResultItem({
            title: 'Preview Page',
            markdown: '# Preview Content',
            source_url: 'https://preview.com/page',
          }),
        ],
      })

      const props = createDefaultProps({
        onPreview,
        onCheckedCrawlResultChange,
        onJobIdChange,
      })

      render(<WaterCrawl {...props} />)

      // Step 1: Enter URL
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://preview.com')

      // Step 2: Run crawl
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Step 3: Wait for completion
      await waitFor(() => {
        expect(screen.getByText('Preview Page'))!.toBeInTheDocument()
      })

      // Step 4: Click preview
      const previewButton = screen.getByText('datasetCreation.stepOne.website.preview')
      await userEvent.click(previewButton)

      expect(onJobIdChange).toHaveBeenCalledWith('preview-workflow-job')
      expect(onCheckedCrawlResultChange).toHaveBeenCalled()
      expect(onPreview).toHaveBeenCalledExactlyOnceWith(
        createCrawlResultItem({
          title: 'Preview Page',
          markdown: '# Preview Content',
          source_url: 'https://preview.com/page',
        }),
      )
    })
  })
})

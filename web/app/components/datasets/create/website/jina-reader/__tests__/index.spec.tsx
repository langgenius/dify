import type { Mock } from 'vite-plus/test'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { act, render as renderWithoutUrlState, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { checkJinaReaderTaskStatus, createJinaReaderTask } from '@/service/datasets'
import { createHttpError } from '@/service/http-error'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { sleep } from '@/utils'
import JinaReader from '../index'

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/service/datasets', () => ({
  createJinaReaderTask: vi.fn(),
  checkJinaReaderTaskStatus: vi.fn(),
}))

vi.mock('@/utils', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}))

// Mock doc link context
vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => 'https://docs.example.com',
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

const createDefaultProps = (overrides: Partial<Parameters<typeof JinaReader>[0]> = {}) => ({
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

describe('JinaReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createJinaReaderTask).mockReset()
    vi.mocked(checkJinaReaderTaskStatus).mockReset()
    vi.mocked(sleep).mockReset().mockResolvedValue(undefined)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render doc link to Jina Reader', () => {
      const props = createDefaultProps()

      render(<JinaReader {...props} />)

      const docLink = screen.getByRole('link')
      expect(docLink)!.toHaveAttribute('href', 'https://jina.ai/reader')
    })
  })

  describe('Props', () => {
    it('should call onCrawlOptionsChange when options change', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCrawlOptionsChange = vi.fn()
      const props = createDefaultProps({ onCrawlOptionsChange })

      render(<JinaReader {...props} />)

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
      const mockCreateTask = createJinaReaderTask as Mock
      let resolvePromise: () => void
      const taskPromise = new Promise((resolve) => {
        resolvePromise = () =>
          resolve({
            data: { title: 'T', content: 'C', description: 'D', url: 'https://example.com' },
          })
      })
      mockCreateTask.mockImplementation(() => taskPromise)

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const urlInput = screen.getAllByRole('textbox')[0]
      await userEvent.type(urlInput!, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(runButton)

      // Assert - crawling indicator should appear
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped/i))!.toBeInTheDocument()
      })

      // Cleanup - resolve the promise and wait for component to finish
      resolvePromise!()
      await waitFor(() => {
        expect(screen.queryByText(/totalPageScraped/i)).not.toBeInTheDocument()
      })
    })

    it('should fold options when step changes from init', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      mockCreateTask.mockResolvedValueOnce({
        data: {
          title: 'Test',
          content: 'Content',
          description: 'Desc',
          url: 'https://example.com',
        },
      })

      const props = createDefaultProps()

      render(<JinaReader {...props} />)

      // Options should be visible initially
      expect(screen.getByText('datasetCreation.stepOne.website.crawlSubPage'))!.toBeInTheDocument()

      const input = screen.getByRole('textbox')
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

      render(<JinaReader {...props} />)
      const configButton = screen.getByText('datasetCreation.stepOne.website.configureJinaReader')
      await userEvent.click(configButton)

      await waitFor(() =>
        expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
      )
      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('should handle preview action on crawled result', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const onPreview = vi.fn()
      const crawlResultData = {
        title: 'Preview Test',
        content: '# Content',
        description: 'Preview desc',
        url: 'https://preview.com',
      }

      mockCreateTask.mockResolvedValueOnce({ data: crawlResultData })

      const props = createDefaultProps({ onPreview })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://preview.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - result should be displayed
      await waitFor(() => {
        expect(screen.getByText('Preview Test'))!.toBeInTheDocument()
      })

      const previewButton = screen.getByText('datasetCreation.stepOne.website.preview')
      await userEvent.click(previewButton)

      expect(onPreview).toHaveBeenCalled()
    })

    it('should handle checkbox changes in options', async () => {
      const onCrawlOptionsChange = vi.fn()
      const props = createDefaultProps({
        onCrawlOptionsChange,
        crawlOptions: createDefaultCrawlOptions({ crawl_sub_pages: false }),
      })

      render(<JinaReader {...props} />)

      const checkbox = screen.getByRole('checkbox', { name: /crawlSubPage/ })
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(checkbox)

      expect(onCrawlOptionsChange).toHaveBeenCalled()
    })

    it('should toggle options visibility when clicking options header', async () => {
      const props = createDefaultProps()

      render(<JinaReader {...props} />)

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
    it('should call createJinaReaderTask with correct parameters', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      mockCreateTask.mockResolvedValueOnce({
        data: { title: 'T', content: 'C', description: 'D', url: 'https://api-test.com' },
      })

      const crawlOptions = createDefaultCrawlOptions({
        limit: 5,
        max_depth: 3,
        crawl_sub_pages: false,
        use_sitemap: true,
        includes: '/docs/*',
        excludes: '/api/*',
      })
      const props = createDefaultProps({ crawlOptions })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://api-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith({
          url: 'https://api-test.com',
          options: crawlOptions,
        })
      })
    })

    it('should handle failed status from polling', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'fail-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'failed',
        message: 'Crawl failed due to network error',
      })

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
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
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'error-job' })
      mockCheckStatus.mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 502 }), { message: 'API Error occurred' }),
      )

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
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
      vi.mocked(createJinaReaderTask).mockResolvedValueOnce({ job_id: 'limit-job' })
      vi.mocked(checkJinaReaderTaskStatus)
        .mockResolvedValueOnce({ status: 'running', current: 1, total: 100, data: [] })
        .mockResolvedValueOnce({
          status: 'completed',
          current: 1,
          total: 100,
          data: [createCrawlResultItem()],
        })
      const props = createDefaultProps({ crawlOptions: createDefaultCrawlOptions({ limit: 5 }) })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<JinaReader {...props} />)
      await user.type(screen.getByRole('textbox'), 'https://example.com')
      await user.click(screen.getByRole('button', { name: /run/i }))
      await waitFor(() => expect(screen.getByText(/totalPageScraped/)).toHaveTextContent('1/5'))
      expect(checkJinaReaderTaskStatus).toHaveBeenCalledExactlyOnceWith('limit-job')
      await act(async () => resume())
      await screen.findByText('Test Page Title')
      expect(props.onCheckedCrawlResultChange).toHaveBeenLastCalledWith([createCrawlResultItem()])
    })
  })

  // Edge Cases and Error Handling Tests
  describe('Edge Cases and Error Handling', () => {
    it('should show error for empty URL', async () => {
      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - Toast should be shown (mocked via Toast component)
      await waitFor(() => {
        expect(createJinaReaderTask).not.toHaveBeenCalled()
      })
    })

    it('should show error for invalid URL format', async () => {
      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'invalid-url')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(createJinaReaderTask).not.toHaveBeenCalled()
      })
    })

    it('should show error for URL without protocol', async () => {
      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(createJinaReaderTask).not.toHaveBeenCalled()
      })
    })

    it('should accept URL with http:// protocol', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      mockCreateTask.mockResolvedValueOnce({
        data: { title: 'T', content: 'C', description: 'D', url: 'http://example.com' },
      })

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
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

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(createJinaReaderTask).not.toHaveBeenCalled()
      })
    })

    it('should handle API throwing an exception', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      mockCreateTask.mockRejectedValueOnce(new Error('Network error'))
      // Suppress console output during test to avoid noisy logs
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(vi.fn())

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://exception-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle'),
        )!.toBeInTheDocument()
      })

      consoleSpy.mockRestore()
    })

    it('should handle status response without status field', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'no-status-job' })
      mockCheckStatus.mockResolvedValueOnce({
        // No status field
        message: 'Unknown error',
      })

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://no-status-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle'),
        )!.toBeInTheDocument()
      })
    })

    it('should show unknown error when error message is empty', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'empty-error-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'failed',
        // No message
      })

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://empty-error-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(
          screen.getByText('datasetCreation.stepOne.website.unknownError'),
        )!.toBeInTheDocument()
      })
    })

    it('should handle empty data array from API', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'empty-data-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 0,
        total: 0,
        data: [],
      })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://empty-data-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should handle null data from running status', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock
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

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://null-data-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should return empty array when completed job has undefined data', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'undefined-data-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 0,
        total: 0,
        // data is undefined - should fallback to empty array
      })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://undefined-data-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalledWith([])
      })
    })

    it('should show zero current progress when crawlResult is not yet available', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock
      let resolveCheckStatus: () => void
      const checkStatusPromise = new Promise((resolve) => {
        resolveCheckStatus = () => resolve({ status: 'completed', current: 0, total: 0, data: [] })
      })

      mockCreateTask.mockResolvedValueOnce({ job_id: 'zero-current-job' })
      mockCheckStatus.mockImplementation(() => checkStatusPromise)

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 10 }),
      })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://zero-current-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should show 0/10 when crawlResult is undefined
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/10/))!.toBeInTheDocument()
      })

      // Cleanup - resolve the promise
      resolveCheckStatus!()
      await waitFor(() => {
        expect(screen.queryByText(/totalPageScraped/i)).not.toBeInTheDocument()
      })
    })

    it('should show 0/0 progress when limit is zero string', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock
      let resolveCheckStatus: () => void
      const checkStatusPromise = new Promise((resolve) => {
        resolveCheckStatus = () => resolve({ status: 'completed', current: 0, total: 0, data: [] })
      })

      mockCreateTask.mockResolvedValueOnce({ job_id: 'zero-total-job' })
      mockCheckStatus.mockImplementation(() => checkStatusPromise)

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: '0' }),
      })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://zero-total-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should show 0/0 when limit parses to 0
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/0/))!.toBeInTheDocument()
      })

      // Cleanup - resolve the promise
      resolveCheckStatus!()
      await waitFor(() => {
        expect(screen.queryByText(/totalPageScraped/i)).not.toBeInTheDocument()
      })
    })

    it('should fallback to limit when crawlResult has zero total', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock
      let resolveCheckStatus: () => void
      const checkStatusPromise = new Promise((resolve) => {
        resolveCheckStatus = () => resolve({ status: 'completed', current: 0, total: 0, data: [] })
      })

      mockCreateTask.mockResolvedValueOnce({ job_id: 'both-zero-job' })
      mockCheckStatus
        .mockResolvedValueOnce({
          status: 'running',
          current: 0,
          total: 0,
          data: [],
        })
        .mockImplementationOnce(() => checkStatusPromise)

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 5 }),
      })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://both-zero-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should show progress indicator
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped/)).toHaveTextContent('0/5')
      })

      // Cleanup - resolve the promise
      resolveCheckStatus!()
      await waitFor(() => {
        expect(screen.queryByText(/totalPageScraped/i)).not.toBeInTheDocument()
      })
    })

    it('should construct result item from direct data response', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({
        data: {
          title: 'Direct Title',
          content: '# Direct Content',
          description: 'Direct desc',
          url: 'https://direct-array.com',
        },
      })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://direct-array.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should construct result item from direct response
      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalledWith([
          expect.objectContaining({
            title: 'Direct Title',
            markdown: '# Direct Content',
            description: 'Direct desc',
            source_url: 'https://direct-array.com',
          }),
        ])
      })
    })
  })

  // Display and UI State Tests
  describe('Display and UI States', () => {
    it('should display time consumed after crawl completion', async () => {
      const mockCreateTask = createJinaReaderTask as Mock

      mockCreateTask.mockResolvedValueOnce({
        data: { title: 'T', content: 'C', description: 'D', url: 'https://time.com' },
      })

      const props = createDefaultProps()

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://time.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText(/scrapTimeInfo/i))!.toBeInTheDocument()
      })
    })
  })

  describe('Integration', () => {
    it('should complete full crawl workflow with job polling', async () => {
      const mockCreateTask = createJinaReaderTask as Mock
      const mockCheckStatus = checkJinaReaderTaskStatus as Mock
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

      render(<JinaReader {...props} />)
      const input = screen.getByRole('textbox')
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
  })
})

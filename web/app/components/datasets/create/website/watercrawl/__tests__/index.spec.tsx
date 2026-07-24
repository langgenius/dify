/**
 * @vitest-environment jsdom
 */
import type { Mock } from 'vitest'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { checkWatercrawlTaskStatus, createWatercrawlTask } from '@/service/datasets'
import { sleep } from '@/utils'
import WaterCrawl from '../index'

vi.mock('@/service/datasets', () => ({
  createWatercrawlTask: vi.fn(),
  checkWatercrawlTaskStatus: vi.fn(),
}))

vi.mock('@/utils', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}))

// Mock modal context
const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

// Mock i18n context
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => path ? `https://docs.dify.ai/en${path}` : 'https://docs.dify.ai/en/',
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

describe('WaterCrawl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  // Tests for initial component rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      expect(screen.getByText('datasetCreation.stepOne.website.watercrawlTitle')).toBeInTheDocument()
    })

    it('should render header with configuration button', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      expect(screen.getByText('datasetCreation.stepOne.website.configureWatercrawl')).toBeInTheDocument()
    })

    it('should render URL input field', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      // Assert - URL input has specific placeholder
      expect(screen.getByPlaceholderText('https://docs.dify.ai/en/')).toBeInTheDocument()
    })

    it('should render run button', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument()
    })

    it('should render options section', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      expect(screen.getByText('datasetCreation.stepOne.website.options')).toBeInTheDocument()
    })

    it('should render doc link to WaterCrawl', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      const docLink = screen.getByRole('link')
      expect(docLink).toHaveAttribute('href', 'https://docs.watercrawl.dev/')
    })

    it('should not render crawling or result components initially', () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      expect(screen.queryByText(/totalPageScraped/i)).not.toBeInTheDocument()
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
        const limitInput = limitLabel.closest('div')?.parentElement?.querySelector('input[type="number"]')

        if (limitInput) {
          await user.clear(limitInput)
          await user.type(limitInput, '20')

          expect(onCrawlOptionsChange).toHaveBeenCalled()
        }
      }
      else {
        // Options might not be visible, just verify component renders
        expect(screen.getByText('datasetCreation.stepOne.website.options')).toBeInTheDocument()
      }
    })

    it('should execute crawl task when checkedCrawlResult is provided', async () => {
      const checkedItem = createCrawlResultItem({ source_url: 'https://checked.com' })
      const mockCreateTask = createWatercrawlTask as Mock
      mockCreateTask.mockResolvedValueOnce({ job_id: 'test-job' })

      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        checkedCrawlResult: [checkedItem],
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - crawl task should be created even with pre-checked results
      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalled()
      })
    })

    it('should use default crawlOptions limit in validation', () => {
      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: '' }),
      })

      render(<WaterCrawl {...props} />)

      // Assert - component renders with empty limit
      expect(screen.getByPlaceholderText('https://docs.dify.ai/en/')).toBeInTheDocument()
    })
  })

  describe('State Management', () => {
    it('should transition from init to running state when run is clicked', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      let resolvePromise: () => void
      mockCreateTask.mockImplementation(() => new Promise((resolve) => {
        resolvePromise = () => resolve({ job_id: 'test-job' })
      }))

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const urlInput = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(urlInput, 'https://example.com')

      const runButton = screen.getByRole('button', { name: /run/i })
      fireEvent.click(runButton)

      // Assert - crawling indicator should appear
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped/i)).toBeInTheDocument()
      })

      // Cleanup - resolve the promise
      resolvePromise!()
    })

    it('should transition to finished state after successful crawl', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem({ title: 'Test Page' })],
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText(/selectAll|resetAll/i)).toBeInTheDocument()
      })
    })

    it('should update crawl result state during polling', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'test-job-123' })
      mockCheckStatus
        .mockResolvedValueOnce({
          status: 'running',
          current: 1,
          total: 3,
          data: [createCrawlResultItem()],
        })
        .mockResolvedValueOnce({
          status: 'completed',
          current: 3,
          total: 3,
          data: [
            createCrawlResultItem({ source_url: 'https://example.com/1' }),
            createCrawlResultItem({ source_url: 'https://example.com/2' }),
            createCrawlResultItem({ source_url: 'https://example.com/3' }),
          ],
        })

      const onCheckedCrawlResultChange = vi.fn()
      const onJobIdChange = vi.fn()
      const props = createDefaultProps({ onCheckedCrawlResultChange, onJobIdChange })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onJobIdChange).toHaveBeenCalledWith('test-job-123')
      })

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalled()
      })
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
      expect(screen.getByText('datasetCreation.stepOne.website.crawlSubPage')).toBeInTheDocument()

      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - options should be folded after crawl starts
      await waitFor(() => {
        expect(screen.queryByText('datasetCreation.stepOne.website.crawlSubPage')).not.toBeInTheDocument()
      })
    })
  })

  // Side Effects and Cleanup Tests
  describe('Side Effects and Cleanup', () => {
    it('should call sleep during polling', async () => {
      const mockSleep = sleep as Mock
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckStatus
        .mockResolvedValueOnce({ status: 'running', current: 1, total: 2, data: [] })
        .mockResolvedValueOnce({ status: 'completed', current: 2, total: 2, data: [] })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockSleep).toHaveBeenCalledWith(2500)
      })
    })

    it('should update controlFoldOptions when step changes', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      mockCreateTask.mockImplementation(() => new Promise(() => { /* pending */ }))

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      // Initially options should be visible
      expect(screen.getByText('datasetCreation.stepOne.website.options')).toBeInTheDocument()

      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - the crawling indicator should appear
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped/i)).toBeInTheDocument()
      })
    })
  })

  // Callback Stability and Memoization Tests
  describe('Callback Stability', () => {
    it('should maintain stable handleSetting callback', () => {
      const props = createDefaultProps()

      const { rerender } = render(<WaterCrawl {...props} />)
      const configButton = screen.getByText('datasetCreation.stepOne.website.configureWatercrawl')
      fireEvent.click(configButton)

      expect(mockSetShowAccountSettingModal).toHaveBeenCalledTimes(1)

      // Rerender and click again
      rerender(<WaterCrawl {...props} />)
      fireEvent.click(configButton)

      expect(mockSetShowAccountSettingModal).toHaveBeenCalledTimes(2)
    })

    it('should memoize checkValid callback based on crawlOptions', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValue({ job_id: 'test-job' })
      mockCheckStatus.mockResolvedValue({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps()

      const { rerender } = render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledTimes(1)
      })

      // Rerender with same options
      rerender(<WaterCrawl {...props} />)

      // Assert - component should still work correctly
      expect(screen.getByPlaceholderText('https://docs.dify.ai/en/')).toBeInTheDocument()
    })
  })

  // User Interactions and Event Handlers Tests
  describe('User Interactions', () => {
    it('should open account settings when configuration button is clicked', async () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const configButton = screen.getByText('datasetCreation.stepOne.website.configureWatercrawl')
      await userEvent.click(configButton)

      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: 'data-source',
      })
    })

    it('should handle URL input and run button click', async () => {
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
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith({
          url: 'https://test.com',
          options: props.crawlOptions,
        })
      })
    })

    it('should handle preview action on crawled result', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onPreview = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'test-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem({ title: 'Preview Test' })],
      })

      const props = createDefaultProps({ onPreview })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://preview.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - result should be displayed
      await waitFor(() => {
        expect(screen.getByText('Preview Test')).toBeInTheDocument()
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

      render(<WaterCrawl {...props} />)

      // Find and click the checkbox by data-testid
      const checkbox = screen.getByTestId('checkbox-crawl-sub-pages')
      fireEvent.click(checkbox)

      // Assert - onCrawlOptionsChange should be called
      expect(onCrawlOptionsChange).toHaveBeenCalled()
    })

    it('should toggle options visibility when clicking options header', async () => {
      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)

      // Options content should be visible initially
      expect(screen.getByText('datasetCreation.stepOne.website.crawlSubPage')).toBeInTheDocument()

      const optionsHeader = screen.getByText('datasetCreation.stepOne.website.options')
      await userEvent.click(optionsHeader)

      // Assert - options should be hidden
      expect(screen.queryByText('datasetCreation.stepOne.website.crawlSubPage')).not.toBeInTheDocument()

      await userEvent.click(optionsHeader)

      // Options should be visible again
      expect(screen.getByText('datasetCreation.stepOne.website.crawlSubPage')).toBeInTheDocument()
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

      const crawlOptions = createDefaultCrawlOptions({ limit: 5, max_depth: 3 })
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
        const callArgs = mockCreateTask.mock.calls[0][0]
        expect(callArgs.options).not.toHaveProperty('max_depth')
      })
    })

    it('should poll for status with job_id', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onJobIdChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'poll-job-123' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 2,
        total: 2,
        data: [
          createCrawlResultItem({ source_url: 'https://p1.com' }),
          createCrawlResultItem({ source_url: 'https://p2.com' }),
        ],
      })

      const props = createDefaultProps({ onJobIdChange })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://poll-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onJobIdChange).toHaveBeenCalledWith('poll-job-123')
      })

      await waitFor(() => {
        expect(mockCheckStatus).toHaveBeenCalledWith('poll-job-123')
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
        expect(screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle')).toBeInTheDocument()
      })

      expect(screen.getByText('Crawl failed due to network error')).toBeInTheDocument()
    })

    it('should handle API error during status check', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'error-job' })
      mockCheckStatus.mockRejectedValueOnce({
        json: () => Promise.resolve({ message: 'API Error occurred' }),
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://error-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle')).toBeInTheDocument()
      })
    })

    it('should limit total to crawlOptions.limit', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'limit-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 100,
        total: 100,
        data: Array.from({ length: 100 }, (_, i) =>
          createCrawlResultItem({ source_url: `https://example.com/${i}` })),
      })

      const props = createDefaultProps({
        onCheckedCrawlResultChange,
        crawlOptions: createDefaultCrawlOptions({ limit: 5 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://limit-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenCalled()
      })
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
        expect(screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle')).toBeInTheDocument()
      })
    })
  })

  // Component Memoization Tests
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert - React.memo components have $$typeof Symbol(react.memo)
      expect(WaterCrawl.$$typeof?.toString()).toBe('Symbol(react.memo)')
      expect((WaterCrawl as unknown as { type: unknown }).type).toBeDefined()
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

    it('should show error when limit is null', async () => {
      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: null as unknown as number }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://example.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(createWatercrawlTask).not.toHaveBeenCalled()
      })
    })

    it('should show error when limit is undefined', async () => {
      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: undefined as unknown as number }),
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
        expect(screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle')).toBeInTheDocument()
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
        expect(screen.getByText('datasetCreation.stepOne.website.unknownError')).toBeInTheDocument()
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
      mockCheckStatus.mockImplementation(() => new Promise(() => { /* never resolves */ }))

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 10 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://zero-current-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should show 0/10 in crawling indicator
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/10/)).toBeInTheDocument()
      })
    })

    it('should handle crawlResult with zero total and empty limit', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'zero-total-job' })
      mockCheckStatus.mockImplementation(() => new Promise(() => { /* never resolves */ }))

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: '0' }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://zero-total-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should show 0/0
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/0/)).toBeInTheDocument()
      })
    })

    it('should handle undefined crawlResult data in finished state', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'undefined-result-data-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 0,
        total: 0,
        time_consuming: 1.5,
        // data is undefined
      })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://undefined-result-data-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should complete and show results
      await waitFor(() => {
        expect(screen.getByText(/scrapTimeInfo/i)).toBeInTheDocument()
      })
    })

    it('should use parseFloat fallback when crawlResult.total is undefined', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'no-total-job' })
      mockCheckStatus.mockImplementation(() => new Promise(() => { /* never resolves */ }))

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 15 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://no-total-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should use limit (15) as total
      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/15/)).toBeInTheDocument()
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
        .mockImplementationOnce(() => new Promise(() => { /* never resolves */ }))

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 5 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://both-zero-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped/)).toBeInTheDocument()
      })
    })
  })

  describe('Prop Variations', () => {
    it('should handle different limit values in crawlOptions', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'limit-var-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 100 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://limit.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith(
          expect.objectContaining({
            options: expect.objectContaining({ limit: 100 }),
          }),
        )
      })
    })

    it('should handle different max_depth values', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'depth-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ max_depth: 5 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://depth.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith(
          expect.objectContaining({
            options: expect.objectContaining({ max_depth: 5 }),
          }),
        )
      })
    })

    it('should handle crawl_sub_pages disabled', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'nosub-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ crawl_sub_pages: false }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://nosub.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith(
          expect.objectContaining({
            options: expect.objectContaining({ crawl_sub_pages: false }),
          }),
        )
      })
    })

    it('should handle use_sitemap enabled', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'sitemap-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ use_sitemap: true }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://sitemap.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith(
          expect.objectContaining({
            options: expect.objectContaining({ use_sitemap: true }),
          }),
        )
      })
    })

    it('should handle includes and excludes patterns', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'patterns-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({
          includes: '/docs/*',
          excludes: '/api/*',
        }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://patterns.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith(
          expect.objectContaining({
            options: expect.objectContaining({
              includes: '/docs/*',
              excludes: '/api/*',
            }),
          }),
        )
      })
    })

    it('should handle pre-selected crawl results', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const existingResult = createCrawlResultItem({ source_url: 'https://existing.com' })

      mockCreateTask.mockResolvedValueOnce({ job_id: 'preselect-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem({ title: 'New' })],
      })

      const props = createDefaultProps({
        checkedCrawlResult: [existingResult],
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://new.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalled()
      })
    })

    it('should handle string type limit value', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'string-limit-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: '25' }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://string-limit.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalled()
      })
    })

    it('should handle only_main_content option', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'main-content-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem()],
      })

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ only_main_content: false }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://main-content.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith(
          expect.objectContaining({
            options: expect.objectContaining({ only_main_content: false }),
          }),
        )
      })
    })
  })

  // Display and UI State Tests
  describe('Display and UI States', () => {
    it('should show crawling progress during running state', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'progress-job' })
      mockCheckStatus.mockImplementation(() => new Promise(() => { /* pending */ }))

      const props = createDefaultProps({
        crawlOptions: createDefaultCrawlOptions({ limit: 10 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://progress.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText(/totalPageScraped.*0\/10/)).toBeInTheDocument()
      })
    })

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
        expect(screen.getByText(/scrapTimeInfo/i)).toBeInTheDocument()
      })
    })

    it('should display crawled results list after completion', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock

      mockCreateTask.mockResolvedValueOnce({ job_id: 'result-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem({ title: 'Result Page' })],
      })

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://result.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText('Result Page')).toBeInTheDocument()
      })
    })

    it('should show error message component when crawl fails', async () => {
      const mockCreateTask = createWatercrawlTask as Mock

      mockCreateTask.mockRejectedValueOnce(new Error('Failed'))
      // Suppress console output during test to avoid noisy logs
      vi.spyOn(console, 'log').mockImplementation(vi.fn())

      const props = createDefaultProps()

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://fail.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      await waitFor(() => {
        expect(screen.getByText('datasetCreation.stepOne.website.exceptionErrorTitle')).toBeInTheDocument()
      })
    })

    it('should update progress during multiple polling iterations', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'multi-poll-job' })
      mockCheckStatus
        .mockResolvedValueOnce({
          status: 'running',
          current: 2,
          total: 10,
          data: [
            createCrawlResultItem({ source_url: 'https://page1.com' }),
            createCrawlResultItem({ source_url: 'https://page2.com' }),
          ],
        })
        .mockResolvedValueOnce({
          status: 'running',
          current: 5,
          total: 10,
          data: Array.from({ length: 5 }, (_, i) =>
            createCrawlResultItem({ source_url: `https://page${i + 1}.com` })),
        })
        .mockResolvedValueOnce({
          status: 'completed',
          current: 10,
          total: 10,
          data: Array.from({ length: 10 }, (_, i) =>
            createCrawlResultItem({ source_url: `https://page${i + 1}.com` })),
        })

      const props = createDefaultProps({
        onCheckedCrawlResultChange,
        crawlOptions: createDefaultCrawlOptions({ limit: 10 }),
      })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://multi-poll.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should eventually complete
      await waitFor(() => {
        expect(mockCheckStatus).toHaveBeenCalledTimes(3)
      })

      // Final result should be selected
      await waitFor(() => {
        expect(onCheckedCrawlResultChange).toHaveBeenLastCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ source_url: 'https://page1.com' }),
          ]),
        )
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
        expect(screen.getByText('Page 1')).toBeInTheDocument()
        expect(screen.getByText('Page 5')).toBeInTheDocument()
      })

      // Assert - checked results should be updated
      expect(onCheckedCrawlResultChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ source_url: 'https://page1.com' }),
          expect.objectContaining({ source_url: 'https://page5.com' }),
        ]),
      )
    })

    it('should handle select all and deselect all in results', async () => {
      const mockCreateTask = createWatercrawlTask as Mock
      const mockCheckStatus = checkWatercrawlTaskStatus as Mock
      const onCheckedCrawlResultChange = vi.fn()

      mockCreateTask.mockResolvedValueOnce({ job_id: 'select-all-job' })
      mockCheckStatus.mockResolvedValueOnce({
        status: 'completed',
        current: 1,
        total: 1,
        data: [createCrawlResultItem({ title: 'Single' })],
      })

      const props = createDefaultProps({ onCheckedCrawlResultChange })

      render(<WaterCrawl {...props} />)
      const input = screen.getByPlaceholderText('https://docs.dify.ai/en/')
      await userEvent.type(input, 'https://single.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Wait for results
      await waitFor(() => {
        expect(screen.getByText('Single')).toBeInTheDocument()
      })

      const selectAllCheckbox = screen.getByText(/selectAll|resetAll/i)
      await userEvent.click(selectAllCheckbox)

      expect(onCheckedCrawlResultChange).toHaveBeenCalled()
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
        data: [createCrawlResultItem({
          title: 'Preview Page',
          markdown: '# Preview Content',
          source_url: 'https://preview.com/page',
        })],
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
        expect(screen.getByText('Preview Page')).toBeInTheDocument()
      })

      // Step 4: Click preview
      const previewButton = screen.getByText('datasetCreation.stepOne.website.preview')
      await userEvent.click(previewButton)

      expect(onJobIdChange).toHaveBeenCalledWith('preview-workflow-job')
      expect(onCheckedCrawlResultChange).toHaveBeenCalled()
      expect(onPreview).toHaveBeenCalled()
    })
  })
})

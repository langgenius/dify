import type { WebSourceProps } from '../types'
import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import WebSource from './web-source'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock child components
vi.mock('../../website', () => ({
  __esModule: true,
  default: ({
    checkedCrawlResult,
    onPreview,
    onCheckedCrawlResultChange,
    onCrawlProviderChange,
    onJobIdChange,
    onCrawlOptionsChange,
  }: {
    checkedCrawlResult: CrawlResultItem[]
    onPreview: (item: CrawlResultItem) => void
    onCheckedCrawlResultChange: (items: CrawlResultItem[]) => void
    onCrawlProviderChange: (provider: unknown) => void
    onJobIdChange: (jobId: string) => void
    onCrawlOptionsChange: (options: unknown) => void
  }) => (
    <div data-testid="website-component">
      <span data-testid="checked-count">{checkedCrawlResult.length}</span>
      <button
        data-testid="trigger-preview"
        onClick={() => onPreview({ source_url: 'https://test.com', markdown: 'test', title: 'Test', description: 'Test description' })}
      >
        Preview
      </button>
      <button
        data-testid="trigger-check-change"
        onClick={() => onCheckedCrawlResultChange([{ source_url: 'https://new.com', markdown: 'new', title: 'New', description: 'New description' }])}
      >
        Change Check
      </button>
      <button
        data-testid="trigger-provider-change"
        onClick={() => onCrawlProviderChange('firecrawl')}
      >
        Change Provider
      </button>
      <button
        data-testid="trigger-job-change"
        onClick={() => onJobIdChange('job-123')}
      >
        Change Job
      </button>
      <button
        data-testid="trigger-options-change"
        onClick={() => onCrawlOptionsChange({ max_depth: 2 })}
      >
        Change Options
      </button>
    </div>
  ),
}))

vi.mock('../common/next-step-button', () => ({
  __esModule: true,
  default: ({ disabled, onClick }: { disabled: boolean, onClick: () => void }) => (
    <button data-testid="next-step-button" disabled={disabled} onClick={onClick}>
      Next Step
    </button>
  ),
}))

vi.mock('../common/vector-space-alert', () => ({
  __esModule: true,
  default: ({ show }: { show: boolean }) => (
    show ? <div data-testid="vector-space-alert">Vector Space Full</div> : null
  ),
}))

// Helper to create mock CrawlResultItem
const createMockWebsitePage = (url: string = 'https://example.com'): CrawlResultItem => ({
  source_url: url,
  markdown: '# Test Page\nContent here',
  title: 'Test Page',
  description: 'A test page',
})

// Helper to create mock DataSourceAuth
const createMockDataSourceAuth = () => ({
  author: 'test-author',
  provider: 'firecrawl',
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'firecrawl-plugin',
  icon: 'icon-url',
  name: 'Firecrawl',
  label: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
  description: { en_US: 'Web crawler', zh_Hans: 'Web crawler' },
  credentials_list: [],
})

// Helper to create default crawl options
const createDefaultCrawlOptions = () => ({
  crawl_sub_pages: true,
  only_main_content: true,
  includes: '',
  excludes: '',
  limit: 10,
  max_depth: 2,
  use_sitemap: false,
})

const createDefaultProps = (): WebSourceProps => ({
  shouldShowDataSourceTypeList: true,
  websitePages: [],
  updateWebsitePages: vi.fn(),
  onPreview: vi.fn(),
  onWebsiteCrawlProviderChange: vi.fn(),
  onWebsiteCrawlJobIdChange: vi.fn(),
  crawlOptions: createDefaultCrawlOptions(),
  onCrawlOptionsChange: vi.fn(),
  authedDataSourceList: [],
  isShowVectorSpaceFull: false,
  onStepChange: vi.fn(),
})

describe('WebSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render Website component', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('website-component')).toBeInTheDocument()
    })

    it('should render NextStepButton component', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeInTheDocument()
    })

    it('should pass websitePages count to Website component', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        websitePages: [createMockWebsitePage(), createMockWebsitePage('https://page2.com')],
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('checked-count')).toHaveTextContent('2')
    })

    it('should apply margin top when shouldShowDataSourceTypeList is false', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        shouldShowDataSourceTypeList: false,
      }

      // Act
      const { container } = render(<WebSource {...props} />)

      // Assert
      const wrapper = container.querySelector('.mt-12')
      expect(wrapper).toBeInTheDocument()
    })

    it('should not apply margin top when shouldShowDataSourceTypeList is true', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<WebSource {...props} />)

      // Assert
      const wrapper = container.querySelector('.mt-12')
      expect(wrapper).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Next Button Disabled State Tests
  // ==========================================
  describe('Next Button Disabled State', () => {
    it('should disable next button when no pages', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should disable next button when vector space is full', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        websitePages: [createMockWebsitePage()],
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should enable next button when pages are selected and space available', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        websitePages: [createMockWebsitePage()],
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should enable next button with multiple selected pages', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        websitePages: [createMockWebsitePage('https://a.com'), createMockWebsitePage('https://b.com')],
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should disable next button when both no pages and vector space full', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        websitePages: [],
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })
  })

  // ==========================================
  // Vector Space Alert Tests
  // ==========================================
  describe('Vector Space Alert', () => {
    it('should not show vector space alert by default', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.queryByTestId('vector-space-alert')).not.toBeInTheDocument()
    })

    it('should show vector space alert when isShowVectorSpaceFull is true', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('vector-space-alert')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Callback Tests
  // ==========================================
  describe('Callbacks', () => {
    it('should call onStepChange when next button is clicked', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        websitePages: [createMockWebsitePage()],
      }
      render(<WebSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('next-step-button'))

      // Assert
      expect(props.onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should call onPreview when page preview is triggered', () => {
      // Arrange
      const props = createDefaultProps()
      render(<WebSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-preview'))

      // Assert
      expect(props.onPreview).toHaveBeenCalledWith({ source_url: 'https://test.com', markdown: 'test', title: 'Test', description: 'Test description' })
    })

    it('should call updateWebsitePages when checked result changes', () => {
      // Arrange
      const props = createDefaultProps()
      render(<WebSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-check-change'))

      // Assert
      expect(props.updateWebsitePages).toHaveBeenCalledWith([{ source_url: 'https://new.com', markdown: 'new', title: 'New', description: 'New description' }])
    })

    it('should call onWebsiteCrawlProviderChange when provider changes', () => {
      // Arrange
      const props = createDefaultProps()
      render(<WebSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-provider-change'))

      // Assert
      expect(props.onWebsiteCrawlProviderChange).toHaveBeenCalledWith('firecrawl')
    })

    it('should call onWebsiteCrawlJobIdChange when job id changes', () => {
      // Arrange
      const props = createDefaultProps()
      render(<WebSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-job-change'))

      // Assert
      expect(props.onWebsiteCrawlJobIdChange).toHaveBeenCalledWith('job-123')
    })

    it('should call onCrawlOptionsChange when options change', () => {
      // Arrange
      const props = createDefaultProps()
      render(<WebSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-options-change'))

      // Assert
      expect(props.onCrawlOptionsChange).toHaveBeenCalledWith({ max_depth: 2 })
    })
  })

  // ==========================================
  // Props Passing Tests
  // ==========================================
  describe('Props Passing', () => {
    it('should handle empty authedDataSourceList', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        authedDataSourceList: [],
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('website-component')).toBeInTheDocument()
    })

    it('should handle authedDataSourceList with items', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        authedDataSourceList: [createMockDataSourceAuth()],
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('website-component')).toBeInTheDocument()
    })

    it('should handle custom crawl options', () => {
      // Arrange
      const customOptions = {
        crawl_sub_pages: false,
        only_main_content: false,
        includes: '*.html',
        excludes: '*.pdf',
        limit: 50,
        max_depth: 5,
        use_sitemap: true,
      }
      const props = {
        ...createDefaultProps(),
        crawlOptions: customOptions,
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('website-component')).toBeInTheDocument()
    })
  })

  // ==========================================
  // State Update Tests
  // ==========================================
  describe('State Updates', () => {
    it('should update button state when websitePages changes', () => {
      // Arrange
      const props = createDefaultProps()
      const { rerender } = render(<WebSource {...props} />)

      // Assert initial state
      expect(screen.getByTestId('next-step-button')).toBeDisabled()

      // Act - add pages
      rerender(<WebSource {...props} websitePages={[createMockWebsitePage()]} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should update button state when isShowVectorSpaceFull changes', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        websitePages: [createMockWebsitePage()],
      }
      const { rerender } = render(<WebSource {...props} />)

      // Assert initial state
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()

      // Act - set vector space full
      rerender(<WebSource {...props} isShowVectorSpaceFull={true} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should update layout when shouldShowDataSourceTypeList changes', () => {
      // Arrange
      const props = createDefaultProps()
      const { container, rerender } = render(<WebSource {...props} />)

      // Assert initial state - no mt-12
      expect(container.querySelector('.mt-12')).not.toBeInTheDocument()

      // Act - change to false
      rerender(<WebSource {...props} shouldShowDataSourceTypeList={false} />)

      // Assert - has mt-12
      expect(container.querySelector('.mt-12')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle page with minimal data', () => {
      // Arrange
      const minimalPage: CrawlResultItem = {
        source_url: 'https://minimal.com',
        markdown: '',
        title: '',
        description: '',
      }
      const props = {
        ...createDefaultProps(),
        websitePages: [minimalPage],
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should handle many pages', () => {
      // Arrange
      const manyPages = Array.from({ length: 100 }, (_, i) =>
        createMockWebsitePage(`https://page${i}.com`))
      const props = {
        ...createDefaultProps(),
        websitePages: manyPages,
      }

      // Act
      render(<WebSource {...props} />)

      // Assert
      expect(screen.getByTestId('checked-count')).toHaveTextContent('100')
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })
  })
})

import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Website from '../index'

const mockSetShowAccountSettingModal = vi.fn()

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

vi.mock('../index.module.css', () => ({
  default: {
    jinaLogo: 'jina-logo',
    watercrawlLogo: 'watercrawl-logo',
  },
}))

vi.mock('../firecrawl', () => ({
  default: (props: Record<string, unknown>) => <div data-testid="firecrawl-component" data-props={JSON.stringify(props)} />,
}))

vi.mock('../jina-reader', () => ({
  default: (props: Record<string, unknown>) => <div data-testid="jina-reader-component" data-props={JSON.stringify(props)} />,
}))

vi.mock('../watercrawl', () => ({
  default: (props: Record<string, unknown>) => <div data-testid="watercrawl-component" data-props={JSON.stringify(props)} />,
}))

vi.mock('../no-data', () => ({
  default: ({ onConfig, provider }: { onConfig: () => void, provider: string }) => (
    <div data-testid="no-data-component" data-provider={provider}>
      <button onClick={onConfig} data-testid="no-data-config-button">Configure</button>
    </div>
  ),
}))

let mockEnableJinaReader = true
let mockEnableFirecrawl = true
let mockEnableWatercrawl = true

vi.mock('@/config', () => ({
  get ENABLE_WEBSITE_JINAREADER() { return mockEnableJinaReader },
  get ENABLE_WEBSITE_FIRECRAWL() { return mockEnableFirecrawl },
  get ENABLE_WEBSITE_WATERCRAWL() { return mockEnableWatercrawl },
}))

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

const createMockDataSourceAuth = (
  provider: string,
  credentialsCount = 1,
): DataSourceAuth => ({
  author: 'test',
  provider,
  plugin_id: `${provider}-plugin`,
  plugin_unique_identifier: `${provider}-unique`,
  icon: 'icon.png',
  name: provider,
  label: { en_US: provider, zh_Hans: provider },
  description: { en_US: `${provider} description`, zh_Hans: `${provider} description` },
  credentials_list: Array.from({ length: credentialsCount }, (_, i) => ({
    credential: {},
    type: CredentialTypeEnum.API_KEY,
    name: `cred-${i}`,
    id: `cred-${i}`,
    is_default: i === 0,
    avatar_url: '',
  })),
})

type RenderProps = {
  authedDataSourceList?: DataSourceAuth[]
  enableJina?: boolean
  enableFirecrawl?: boolean
  enableWatercrawl?: boolean
}

const renderWebsite = ({
  authedDataSourceList = [],
  enableJina = true,
  enableFirecrawl = true,
  enableWatercrawl = true,
}: RenderProps = {}) => {
  mockEnableJinaReader = enableJina
  mockEnableFirecrawl = enableFirecrawl
  mockEnableWatercrawl = enableWatercrawl

  const props = {
    onPreview: vi.fn() as (payload: CrawlResultItem) => void,
    checkedCrawlResult: [] as CrawlResultItem[],
    onCheckedCrawlResultChange: vi.fn() as (payload: CrawlResultItem[]) => void,
    onCrawlProviderChange: vi.fn(),
    onJobIdChange: vi.fn(),
    crawlOptions: createMockCrawlOptions(),
    onCrawlOptionsChange: vi.fn() as (payload: CrawlOptions) => void,
    authedDataSourceList,
  }

  const result = render(<Website {...props} />)
  return { ...result, props }
}

describe('Website', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableJinaReader = true
    mockEnableFirecrawl = true
    mockEnableWatercrawl = true
  })

  describe('Rendering', () => {
    it('should render provider selection section', () => {
      renderWebsite()
      expect(screen.getByText(/chooseProvider/i)).toBeInTheDocument()
    })

    it('should show Jina Reader button when ENABLE_WEBSITE_JINAREADER is true', () => {
      renderWebsite({ enableJina: true })
      expect(screen.getByText('Jina Reader')).toBeInTheDocument()
    })

    it('should not show Jina Reader button when ENABLE_WEBSITE_JINAREADER is false', () => {
      renderWebsite({ enableJina: false })
      expect(screen.queryByText('Jina Reader')).not.toBeInTheDocument()
    })

    it('should show Firecrawl button when ENABLE_WEBSITE_FIRECRAWL is true', () => {
      renderWebsite({ enableFirecrawl: true })
      expect(screen.getByText(/Firecrawl/)).toBeInTheDocument()
    })

    it('should not show Firecrawl button when ENABLE_WEBSITE_FIRECRAWL is false', () => {
      renderWebsite({ enableFirecrawl: false })
      expect(screen.queryByText(/Firecrawl/)).not.toBeInTheDocument()
    })

    it('should show WaterCrawl button when ENABLE_WEBSITE_WATERCRAWL is true', () => {
      renderWebsite({ enableWatercrawl: true })
      expect(screen.getByText('WaterCrawl')).toBeInTheDocument()
    })

    it('should not show WaterCrawl button when ENABLE_WEBSITE_WATERCRAWL is false', () => {
      renderWebsite({ enableWatercrawl: false })
      expect(screen.queryByText('WaterCrawl')).not.toBeInTheDocument()
    })
  })

  describe('Provider Selection', () => {
    it('should select Jina Reader by default', () => {
      const authedDataSourceList = [createMockDataSourceAuth('jinareader')]
      renderWebsite({ authedDataSourceList })

      expect(screen.getByTestId('jina-reader-component')).toBeInTheDocument()
    })

    it('should switch to Firecrawl when Firecrawl button clicked', () => {
      const authedDataSourceList = [
        createMockDataSourceAuth('jinareader'),
        createMockDataSourceAuth('firecrawl'),
      ]
      renderWebsite({ authedDataSourceList })

      const firecrawlButton = screen.getByText(/Firecrawl/)
      fireEvent.click(firecrawlButton)

      expect(screen.getByTestId('firecrawl-component')).toBeInTheDocument()
      expect(screen.queryByTestId('jina-reader-component')).not.toBeInTheDocument()
    })

    it('should switch to WaterCrawl when WaterCrawl button clicked', () => {
      const authedDataSourceList = [
        createMockDataSourceAuth('jinareader'),
        createMockDataSourceAuth('watercrawl'),
      ]
      renderWebsite({ authedDataSourceList })

      const watercrawlButton = screen.getByText('WaterCrawl')
      fireEvent.click(watercrawlButton)

      expect(screen.getByTestId('watercrawl-component')).toBeInTheDocument()
      expect(screen.queryByTestId('jina-reader-component')).not.toBeInTheDocument()
    })

    it('should call onCrawlProviderChange when provider switched', () => {
      const authedDataSourceList = [
        createMockDataSourceAuth('jinareader'),
        createMockDataSourceAuth('firecrawl'),
      ]
      const { props } = renderWebsite({ authedDataSourceList })

      const firecrawlButton = screen.getByText(/Firecrawl/)
      fireEvent.click(firecrawlButton)

      expect(props.onCrawlProviderChange).toHaveBeenCalledWith('firecrawl')
    })
  })

  describe('Provider Content', () => {
    it('should show JinaReader component when selected and available', () => {
      const authedDataSourceList = [createMockDataSourceAuth('jinareader')]
      renderWebsite({ authedDataSourceList })

      expect(screen.getByTestId('jina-reader-component')).toBeInTheDocument()
    })

    it('should show Firecrawl component when selected and available', () => {
      const authedDataSourceList = [
        createMockDataSourceAuth('jinareader'),
        createMockDataSourceAuth('firecrawl'),
      ]
      renderWebsite({ authedDataSourceList })

      const firecrawlButton = screen.getByText(/Firecrawl/)
      fireEvent.click(firecrawlButton)

      expect(screen.getByTestId('firecrawl-component')).toBeInTheDocument()
    })

    it('should show NoData when selected provider has no credentials', () => {
      const authedDataSourceList = [createMockDataSourceAuth('jinareader', 0)]
      renderWebsite({ authedDataSourceList })

      expect(screen.getByTestId('no-data-component')).toBeInTheDocument()
    })

    it('should show NoData when no data source available for selected provider', () => {
      renderWebsite({ authedDataSourceList: [] })

      expect(screen.getByTestId('no-data-component')).toBeInTheDocument()
    })
  })

  describe('NoData Config', () => {
    it('should call setShowAccountSettingModal when NoData onConfig is triggered', () => {
      renderWebsite({ authedDataSourceList: [] })

      const configButton = screen.getByTestId('no-data-config-button')
      fireEvent.click(configButton)

      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: 'data-source',
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle no providers enabled', () => {
      renderWebsite({
        enableJina: false,
        enableFirecrawl: false,
        enableWatercrawl: false,
      })

      expect(screen.queryByText('Jina Reader')).not.toBeInTheDocument()
      expect(screen.queryByText(/Firecrawl/)).not.toBeInTheDocument()
      expect(screen.queryByText('WaterCrawl')).not.toBeInTheDocument()
    })

    it('should handle only one provider enabled', () => {
      renderWebsite({
        enableJina: true,
        enableFirecrawl: false,
        enableWatercrawl: false,
      })

      expect(screen.getByText('Jina Reader')).toBeInTheDocument()
      expect(screen.queryByText(/Firecrawl/)).not.toBeInTheDocument()
      expect(screen.queryByText('WaterCrawl')).not.toBeInTheDocument()
    })
  })
})

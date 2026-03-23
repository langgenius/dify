import type { AppContextValue } from '@/context/app-context'
import type { CommonResponse } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { useAppContext } from '@/context/app-context'
import { DataSourceProvider } from '@/models/common'
import { fetchDataSources, removeDataSourceApiKeyBinding } from '@/service/datasets'
import DataSourceWebsite from '../index'

/**
 * DataSourceWebsite Component Tests
 * Tests integration of multiple website scraping providers (Firecrawl, WaterCrawl, Jina Reader).
 */

type DataSourcesResponse = CommonResponse & {
  sources: Array<{ id: string, provider: DataSourceProvider }>
}

const { mockToastSuccess } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/service/datasets', () => ({
  fetchDataSources: vi.fn(),
  removeDataSourceApiKeyBinding: vi.fn(),
  createDataSourceApiKeyBinding: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
  },
}))

describe('DataSourceWebsite Component', () => {
  const mockSources = [
    { id: '1', provider: DataSourceProvider.fireCrawl },
    { id: '2', provider: DataSourceProvider.waterCrawl },
    { id: '3', provider: DataSourceProvider.jinaReader },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppContext).mockReturnValue({ isCurrentWorkspaceManager: true } as unknown as AppContextValue)
    vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [] } as DataSourcesResponse)
  })

  const renderAndWait = async (provider: DataSourceProvider) => {
    const result = render(<DataSourceWebsite provider={provider} />)
    await waitFor(() => expect(fetchDataSources).toHaveBeenCalled())
    return result
  }

  describe('Data Initialization', () => {
    it('should fetch data sources on mount and reflect configured status', async () => {
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: mockSources } as DataSourcesResponse)

      await renderAndWait(DataSourceProvider.fireCrawl)

      expect(screen.getByText('common.dataSource.website.configuredCrawlers')).toBeInTheDocument()
    })

    it('should pass readOnly status based on workspace manager permissions', async () => {
      vi.mocked(useAppContext).mockReturnValue({ isCurrentWorkspaceManager: false } as unknown as AppContextValue)

      await renderAndWait(DataSourceProvider.fireCrawl)

      expect(screen.getByText('common.dataSource.configure')).toHaveClass('cursor-default')
    })
  })

  describe('Provider Specific Rendering', () => {
    it('should render correct logo and name for Firecrawl', async () => {
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[0]] } as DataSourcesResponse)

      await renderAndWait(DataSourceProvider.fireCrawl)

      expect(await screen.findByText('Firecrawl')).toBeInTheDocument()
      expect(screen.getByText('🔥')).toBeInTheDocument()
    })

    it('should render correct logo and name for WaterCrawl', async () => {
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[1]] } as DataSourcesResponse)

      await renderAndWait(DataSourceProvider.waterCrawl)

      const elements = await screen.findAllByText('WaterCrawl')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })

    it('should render correct logo and name for Jina Reader', async () => {
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[2]] } as DataSourcesResponse)

      await renderAndWait(DataSourceProvider.jinaReader)

      const elements = await screen.findAllByText('Jina Reader')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Modal Interactions', () => {
    it('should manage opening and closing of configuration modals', async () => {
      await renderAndWait(DataSourceProvider.fireCrawl)

      fireEvent.click(screen.getByText('common.dataSource.configure'))
      expect(screen.getByText('datasetCreation.firecrawl.configFirecrawl')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
      expect(screen.queryByText('datasetCreation.firecrawl.configFirecrawl')).not.toBeInTheDocument()
    })

    it('should re-fetch sources after saving configuration (Watercrawl)', async () => {
      await renderAndWait(DataSourceProvider.waterCrawl)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      vi.mocked(fetchDataSources).mockClear()

      fireEvent.change(screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder'), { target: { value: 'test-key' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByText('datasetCreation.watercrawl.configWatercrawl')).not.toBeInTheDocument()
      })
    })

    it('should re-fetch sources after saving configuration (Jina Reader)', async () => {
      await renderAndWait(DataSourceProvider.jinaReader)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      vi.mocked(fetchDataSources).mockClear()

      fireEvent.change(screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder'), { target: { value: 'test-key' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByText('datasetCreation.jinaReader.configJinaReader')).not.toBeInTheDocument()
      })
    })
  })

  describe('Management Actions', () => {
    it('should handle successful data source removal with toast notification', async () => {
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[0]] } as DataSourcesResponse)
      vi.mocked(removeDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' } as CommonResponse)
      await renderAndWait(DataSourceProvider.fireCrawl)
      await waitFor(() => expect(screen.getByText('common.dataSource.website.configuredCrawlers')).toBeInTheDocument())

      const removeBtn = screen.getByText('Firecrawl').parentElement?.querySelector('svg')?.parentElement
      if (removeBtn)
        fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(removeDataSourceApiKeyBinding).toHaveBeenCalledWith('1')
        expect(mockToastSuccess).toHaveBeenCalledWith('common.api.remove')
      })
      expect(screen.queryByText('common.dataSource.website.configuredCrawlers')).not.toBeInTheDocument()
    })

    it('should skip removal API call if no data source ID is present', async () => {
      await renderAndWait(DataSourceProvider.fireCrawl)

      const removeBtn = screen.queryByText('Firecrawl')?.parentElement?.querySelector('svg')?.parentElement
      if (removeBtn)
        fireEvent.click(removeBtn)

      expect(removeDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })

  describe('Firecrawl Save Flow', () => {
    it('should re-fetch sources after saving Firecrawl configuration', async () => {
      await renderAndWait(DataSourceProvider.fireCrawl)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      expect(screen.getByText('datasetCreation.firecrawl.configFirecrawl')).toBeInTheDocument()
      vi.mocked(fetchDataSources).mockClear()

      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder')
      fireEvent.change(apiKeyInput, { target: { value: 'test-key' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByText('datasetCreation.firecrawl.configFirecrawl')).not.toBeInTheDocument()
      })
    })
  })

  describe('Cancel Flow', () => {
    it('should close watercrawl modal when cancel is clicked', async () => {
      await renderAndWait(DataSourceProvider.waterCrawl)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      expect(screen.getByText('datasetCreation.watercrawl.configWatercrawl')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      await waitFor(() => {
        expect(screen.queryByText('datasetCreation.watercrawl.configWatercrawl')).not.toBeInTheDocument()
      })
    })

    it('should close jina reader modal when cancel is clicked', async () => {
      await renderAndWait(DataSourceProvider.jinaReader)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      expect(screen.getByText('datasetCreation.jinaReader.configJinaReader')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      await waitFor(() => {
        expect(screen.queryByText('datasetCreation.jinaReader.configJinaReader')).not.toBeInTheDocument()
      })
    })
  })
})

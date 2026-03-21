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

// Mock App Context
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

// Mock Service calls
vi.mock('@/service/datasets', () => ({
  fetchDataSources: vi.fn(),
  removeDataSourceApiKeyBinding: vi.fn(),
  createDataSourceApiKeyBinding: vi.fn(),
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

  // Helper to render and wait for initial fetch to complete
  const renderAndWait = async (provider: DataSourceProvider) => {
    const result = render(<DataSourceWebsite provider={provider} />)
    await waitFor(() => expect(fetchDataSources).toHaveBeenCalled())
    return result
  }

  describe('Data Initialization', () => {
    it('should fetch data sources on mount and reflect configured status', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: mockSources } as DataSourcesResponse)

      // Act
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Assert
      expect(screen.getByText('common.dataSource.website.configuredCrawlers')).toBeInTheDocument()
    })

    it('should pass readOnly status based on workspace manager permissions', async () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({ isCurrentWorkspaceManager: false } as unknown as AppContextValue)

      // Act
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Assert
      expect(screen.getByText('common.dataSource.configure')).toHaveClass('cursor-default')
    })
  })

  describe('Provider Specific Rendering', () => {
    it('should render correct logo and name for Firecrawl', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[0]] } as DataSourcesResponse)

      // Act
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Assert
      expect(await screen.findByText('Firecrawl')).toBeInTheDocument()
      expect(screen.getByText('🔥')).toBeInTheDocument()
    })

    it('should render correct logo and name for WaterCrawl', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[1]] } as DataSourcesResponse)

      // Act
      await renderAndWait(DataSourceProvider.waterCrawl)

      // Assert
      const elements = await screen.findAllByText('WaterCrawl')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })

    it('should render correct logo and name for Jina Reader', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[2]] } as DataSourcesResponse)

      // Act
      await renderAndWait(DataSourceProvider.jinaReader)

      // Assert
      const elements = await screen.findAllByText('Jina Reader')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Modal Interactions', () => {
    it('should manage opening and closing of configuration modals', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Act (Open)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      // Assert
      expect(screen.getByText('datasetCreation.firecrawl.configFirecrawl')).toBeInTheDocument()

      // Act (Cancel)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
      // Assert
      expect(screen.queryByText('datasetCreation.firecrawl.configFirecrawl')).not.toBeInTheDocument()
    })

    it('should re-fetch sources after saving configuration (Watercrawl)', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.waterCrawl)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      vi.mocked(fetchDataSources).mockClear()

      // Act
      fireEvent.change(screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder'), { target: { value: 'test-key' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByText('datasetCreation.watercrawl.configWatercrawl')).not.toBeInTheDocument()
      })
    })

    it('should re-fetch sources after saving configuration (Jina Reader)', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.jinaReader)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      vi.mocked(fetchDataSources).mockClear()

      // Act
      fireEvent.change(screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder'), { target: { value: 'test-key' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByText('datasetCreation.jinaReader.configJinaReader')).not.toBeInTheDocument()
      })
    })
  })

  describe('Management Actions', () => {
    it('should handle successful data source removal with toast notification', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[0]] } as DataSourcesResponse)
      vi.mocked(removeDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' } as CommonResponse)
      await renderAndWait(DataSourceProvider.fireCrawl)
      await waitFor(() => expect(screen.getByText('common.dataSource.website.configuredCrawlers')).toBeInTheDocument())

      // Act
      const removeBtn = screen.getByText('Firecrawl').parentElement?.querySelector('svg')?.parentElement
      if (removeBtn)
        fireEvent.click(removeBtn)

      // Assert
      await waitFor(() => {
        expect(removeDataSourceApiKeyBinding).toHaveBeenCalledWith('1')
        expect(screen.getByText('common.api.remove')).toBeInTheDocument()
      })
      expect(screen.queryByText('common.dataSource.website.configuredCrawlers')).not.toBeInTheDocument()
    })

    it('should skip removal API call if no data source ID is present', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Act
      const removeBtn = screen.queryByText('Firecrawl')?.parentElement?.querySelector('svg')?.parentElement
      if (removeBtn)
        fireEvent.click(removeBtn)

      // Assert
      expect(removeDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })

  describe('Firecrawl Save Flow', () => {
    it('should re-fetch sources after saving Firecrawl configuration', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.fireCrawl)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      expect(screen.getByText('datasetCreation.firecrawl.configFirecrawl')).toBeInTheDocument()
      vi.mocked(fetchDataSources).mockClear()

      // Act - fill in required API key field and save
      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder')
      fireEvent.change(apiKeyInput, { target: { value: 'test-key' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByText('datasetCreation.firecrawl.configFirecrawl')).not.toBeInTheDocument()
      })
    })
  })

  describe('Cancel Flow', () => {
    it('should close watercrawl modal when cancel is clicked', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.waterCrawl)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      expect(screen.getByText('datasetCreation.watercrawl.configWatercrawl')).toBeInTheDocument()

      // Act
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      // Assert - modal closed
      await waitFor(() => {
        expect(screen.queryByText('datasetCreation.watercrawl.configWatercrawl')).not.toBeInTheDocument()
      })
    })

    it('should close jina reader modal when cancel is clicked', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.jinaReader)
      fireEvent.click(screen.getByText('common.dataSource.configure'))
      expect(screen.getByText('datasetCreation.jinaReader.configJinaReader')).toBeInTheDocument()

      // Act
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      // Assert - modal closed
      await waitFor(() => {
        expect(screen.queryByText('datasetCreation.jinaReader.configJinaReader')).not.toBeInTheDocument()
      })
    })
  })
})

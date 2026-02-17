import type { JSX } from 'react'
import type { AppContextValue } from '@/context/app-context'
import type { CommonResponse } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { DataSourceProvider } from '@/models/common'
import { fetchDataSources, removeDataSourceApiKeyBinding } from '@/service/datasets'
import DataSourceWebsite from './index'

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
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock Panel component to verify interactions
vi.mock('../panel', () => ({
  default: ({ isConfigured, onConfigure, onRemove, configuredList, readOnly }: {
    isConfigured: boolean
    onConfigure: () => void
    onRemove: () => void
    configuredList: Array<{ id: string, name: string, logo: (props: { className: string }) => JSX.Element }>
    readOnly: boolean
  }) => (
    <div data-testid="panel">
      <div data-testid="configured-status">{isConfigured ? 'configured' : 'not-configured'}</div>
      <div data-testid="readonly-status">{readOnly ? 'readonly' : 'editable'}</div>
      <button data-testid="configure-btn" onClick={onConfigure}>Configure</button>
      <button data-testid="remove-btn" onClick={onRemove}>Remove</button>
      <div data-testid="configured-items">
        {configuredList.map(item => (
          <div key={item.id} data-testid={`item-${item.id}`}>
            <span data-testid={`name-${item.id}`}>{item.name}</span>
            <div data-testid={`logo-${item.id}`}>{item.logo({ className: 'logo-cls' })}</div>
          </div>
        ))}
      </div>
    </div>
  ),
}))

// Mock Configuration Modals
vi.mock('./config-firecrawl-modal', () => ({
  default: ({ onSaved, onCancel }: { onSaved: () => void, onCancel: () => void }) => (
    <div data-testid="firecrawl-modal">
      <button data-testid="save-firecrawl" onClick={onSaved}>Save</button>
      <button data-testid="cancel-firecrawl" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('./config-watercrawl-modal', () => ({
  default: ({ onSaved, onCancel }: { onSaved: () => void, onCancel: () => void }) => (
    <div data-testid="watercrawl-modal">
      <button data-testid="save-watercrawl" onClick={onSaved}>Save</button>
      <button data-testid="cancel-watercrawl" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('./config-jina-reader-modal', () => ({
  default: ({ onSaved, onCancel }: { onSaved: () => void, onCancel: () => void }) => (
    <div data-testid="jina-modal">
      <button data-testid="save-jina" onClick={onSaved}>Save</button>
      <button data-testid="cancel-jina" onClick={onCancel}>Cancel</button>
    </div>
  ),
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
      expect(screen.getByTestId('configured-status')).toHaveTextContent('configured')
    })

    it('should pass readOnly status based on workspace manager permissions', async () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({ isCurrentWorkspaceManager: false } as unknown as AppContextValue)

      // Act
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Assert
      expect(screen.getByTestId('readonly-status')).toHaveTextContent('readonly')
    })
  })

  describe('Provider Specific Rendering', () => {
    it('should render correct logo and name for Firecrawl', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[0]] } as DataSourcesResponse)

      // Act
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Assert
      expect(await screen.findByTestId('name-1')).toHaveTextContent('Firecrawl')
      expect(screen.getByText('🔥')).toBeInTheDocument()
    })

    it('should render correct logo and name for WaterCrawl', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[1]] } as DataSourcesResponse)

      // Act
      await renderAndWait(DataSourceProvider.waterCrawl)

      // Assert
      expect(await screen.findByTestId('name-2')).toHaveTextContent('WaterCrawl')
      const logoContainer = screen.getByTestId('logo-2').firstChild as HTMLElement
      expect(logoContainer.tagName.toLowerCase()).toBe('div')
      expect(logoContainer.querySelector('span')).toBeInTheDocument()
    })

    it('should render correct logo and name for Jina Reader', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[2]] } as DataSourcesResponse)

      // Act
      await renderAndWait(DataSourceProvider.jinaReader)

      // Assert
      expect(await screen.findByTestId('name-3')).toHaveTextContent('Jina Reader')
      const logoContainer = screen.getByTestId('logo-3').firstChild as HTMLElement
      expect(logoContainer.tagName.toLowerCase()).toBe('div')
      expect(logoContainer.querySelector('span')).toBeInTheDocument()
    })
  })

  describe('Modal Interactions', () => {
    it('should manage opening and closing of configuration modals', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Act (Open)
      fireEvent.click(screen.getByTestId('configure-btn'))
      // Assert
      expect(screen.getByTestId('firecrawl-modal')).toBeInTheDocument()

      // Act (Cancel)
      fireEvent.click(screen.getByTestId('cancel-firecrawl'))
      // Assert
      expect(screen.queryByTestId('firecrawl-modal')).not.toBeInTheDocument()
    })

    it('should re-fetch sources after saving configuration (Watercrawl)', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.waterCrawl)
      fireEvent.click(screen.getByTestId('configure-btn'))
      vi.mocked(fetchDataSources).mockClear()

      // Act
      fireEvent.click(screen.getByTestId('save-watercrawl'))

      // Assert
      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByTestId('watercrawl-modal')).not.toBeInTheDocument()
      })
    })

    it('should re-fetch sources after saving configuration (Jina Reader)', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.jinaReader)
      fireEvent.click(screen.getByTestId('configure-btn'))
      vi.mocked(fetchDataSources).mockClear()

      // Act
      fireEvent.click(screen.getByTestId('save-jina'))

      // Assert
      await waitFor(() => {
        expect(fetchDataSources).toHaveBeenCalled()
        expect(screen.queryByTestId('jina-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('Management Actions', () => {
    it('should handle successful data source removal with toast notification', async () => {
      // Arrange
      vi.mocked(fetchDataSources).mockResolvedValue({ result: 'success', sources: [mockSources[0]] } as DataSourcesResponse)
      vi.mocked(removeDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' } as CommonResponse)
      await renderAndWait(DataSourceProvider.fireCrawl)
      await waitFor(() => expect(screen.getByTestId('configured-status')).toHaveTextContent('configured'))

      // Act
      fireEvent.click(screen.getByTestId('remove-btn'))

      // Assert
      await waitFor(() => {
        expect(removeDataSourceApiKeyBinding).toHaveBeenCalledWith('1')
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
          message: 'common.api.remove',
        }))
      })
      expect(screen.getByTestId('configured-status')).toHaveTextContent('not-configured')
    })

    it('should skip removal API call if no data source ID is present', async () => {
      // Arrange
      await renderAndWait(DataSourceProvider.fireCrawl)

      // Act
      fireEvent.click(screen.getByTestId('remove-btn'))

      // Assert
      expect(removeDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })
})

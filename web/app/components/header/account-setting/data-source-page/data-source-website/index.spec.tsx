'use client'

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
    vi.mocked(fetchDataSources).mockResolvedValue({ sources: [] } as unknown as CommonResponse)
  })

  // Helper to render and wait for initial fetch to complete, avoiding 'act' warnings
  const renderAndWait = async (provider: DataSourceProvider) => {
    const result = render(<DataSourceWebsite provider={provider} />)
    await waitFor(() => expect(fetchDataSources).toHaveBeenCalled())
    return result
  }

  /**
   * Test case: Verify initial data fetching on mount.
   */
  it('should fetch data sources on mount', async () => {
    vi.mocked(fetchDataSources).mockResolvedValue({ sources: mockSources } as unknown as CommonResponse)

    await renderAndWait(DataSourceProvider.fireCrawl)

    // Check if Panel reflects configured status
    expect(screen.getByTestId('configured-status')).toHaveTextContent('configured')
  })

  /**
   * Test case: Verify readOnly status based on workspace manager context.
   */
  it('should pass readOnly status to Panel', async () => {
    vi.mocked(useAppContext).mockReturnValue({ isCurrentWorkspaceManager: false } as unknown as AppContextValue)

    await renderAndWait(DataSourceProvider.fireCrawl)

    expect(screen.getByTestId('readonly-status')).toHaveTextContent('readonly')
  })

  /**
   * Test case: Verify logo and provider name logic for Firecrawl.
   */
  it('should render correct logo and name for Firecrawl', async () => {
    vi.mocked(fetchDataSources).mockResolvedValue({ sources: [mockSources[0]] } as unknown as CommonResponse)

    await renderAndWait(DataSourceProvider.fireCrawl)

    expect(await screen.findByTestId('name-1')).toHaveTextContent('Firecrawl')
    expect(screen.getByText('🔥')).toBeInTheDocument()
  })

  /**
   * Test case: Verify logo and provider name logic for WaterCrawl.
   */
  it('should render correct logo and name for WaterCrawl', async () => {
    vi.mocked(fetchDataSources).mockResolvedValue({ sources: [mockSources[1]] } as unknown as CommonResponse)

    await renderAndWait(DataSourceProvider.waterCrawl)

    expect(await screen.findByTestId('name-2')).toHaveTextContent('WaterCrawl')
    // Watercrawl uses a span with a CSS class from module
    expect(screen.getByTestId('logo-2').firstChild).toBeInTheDocument()
  })

  /**
   * Test case: Verify logo and provider name logic for Jina Reader.
   */
  it('should render correct logo and name for Jina Reader', async () => {
    vi.mocked(fetchDataSources).mockResolvedValue({ sources: [mockSources[2]] } as unknown as CommonResponse)

    await renderAndWait(DataSourceProvider.jinaReader)

    expect(await screen.findByTestId('name-3')).toHaveTextContent('Jina Reader')
    // Jina uses a span with a CSS class from module
    expect(screen.getByTestId('logo-3').firstChild).toBeInTheDocument()
  })

  /**
   * Test case: Verify opening and closing of Config modals.
   */
  it('should open and close configuration modals', async () => {
    await renderAndWait(DataSourceProvider.fireCrawl)

    // Open
    fireEvent.click(screen.getByTestId('configure-btn'))
    expect(screen.getByTestId('firecrawl-modal')).toBeInTheDocument()

    // Cancel
    fireEvent.click(screen.getByTestId('cancel-firecrawl'))
    expect(screen.queryByTestId('firecrawl-modal')).not.toBeInTheDocument()
  })

  /**
   * Test case: Verify behavior after saving configuration.
   */
  it('should re-fetch sources after saving configuration', async () => {
    await renderAndWait(DataSourceProvider.waterCrawl)

    // Open Watercrawl modal
    fireEvent.click(screen.getByTestId('configure-btn'))

    // Clear initial call from mount
    vi.mocked(fetchDataSources).mockClear()

    // Click save
    fireEvent.click(screen.getByTestId('save-watercrawl'))

    await waitFor(() => {
      expect(fetchDataSources).toHaveBeenCalled()
      expect(screen.queryByTestId('watercrawl-modal')).not.toBeInTheDocument()
    })
  })

  /**
   * Test case: Verify saving Jina Reader modal.
   */
  it('should handle Jina Reader configuration save', async () => {
    await renderAndWait(DataSourceProvider.jinaReader)

    fireEvent.click(screen.getByTestId('configure-btn'))
    expect(screen.getByTestId('jina-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('save-jina'))

    await waitFor(() => {
      expect(screen.queryByTestId('jina-modal')).not.toBeInTheDocument()
    })
  })

  /**
   * Test case: Verify removal of a data source.
   */
  it('should remove data source and show notification', async () => {
    vi.mocked(fetchDataSources).mockResolvedValue({ sources: [mockSources[0]] } as unknown as CommonResponse)
    vi.mocked(removeDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' } as CommonResponse)

    await renderAndWait(DataSourceProvider.fireCrawl)

    await waitFor(() => expect(screen.getByTestId('configured-status')).toHaveTextContent('configured'))

    // Click remove
    fireEvent.click(screen.getByTestId('remove-btn'))

    await waitFor(() => {
      expect(removeDataSourceApiKeyBinding).toHaveBeenCalledWith('1')
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        message: expect.stringContaining('api.remove'),
      }))
    })

    // Status should update to not-configured
    expect(screen.getByTestId('configured-status')).toHaveTextContent('not-configured')
  })

  /**
   * Test case: Verify removal does nothing if ID is not found.
   */
  it('should not call remove API if data source ID is missing', async () => {
    await renderAndWait(DataSourceProvider.fireCrawl)

    fireEvent.click(screen.getByTestId('remove-btn'))

    expect(removeDataSourceApiKeyBinding).not.toHaveBeenCalled()
  })
})

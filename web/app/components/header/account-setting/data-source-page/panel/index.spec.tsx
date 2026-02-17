import type { ConfigItemType } from './config-item'
import { fireEvent, render, screen } from '@testing-library/react'
import { DataSourceProvider } from '@/models/common'
import Panel from './index'
import { DataSourceType } from './types'

/**
 * Panel Component Tests
 * Tests layout, conditional rendering, and interactions for data source panels (Notion and Website).
 */

vi.mock('../data-source-notion/operate', () => ({
  default: () => <div data-testid="mock-operate" />,
}))

describe('Panel Component', () => {
  const onConfigure = vi.fn()
  const onRemove = vi.fn()
  const mockConfiguredList: ConfigItemType[] = [
    { id: '1', name: 'Item 1', isActive: true, logo: () => null },
    { id: '2', name: 'Item 2', isActive: false, logo: () => null },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Notion Panel Rendering', () => {
    it('should render Notion panel when not configured and isSupportList is true', () => {
      // Act
      render(
        <Panel
          type={DataSourceType.notion}
          isConfigured={false}
          onConfigure={onConfigure}
          readOnly={false}
          configuredList={[]}
          onRemove={onRemove}
          isSupportList={true}
        />,
      )

      // Assert
      expect(screen.getByText('common.dataSource.notion.title')).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.description')).toBeInTheDocument()
      const connectBtn = screen.getByText('common.dataSource.connect')
      expect(connectBtn).toBeInTheDocument()

      // Act
      fireEvent.click(connectBtn)
      // Assert
      expect(onConfigure).toHaveBeenCalled()
    })

    it('should render Notion panel in readOnly mode when not configured', () => {
      // Act
      render(
        <Panel
          type={DataSourceType.notion}
          isConfigured={false}
          onConfigure={onConfigure}
          readOnly={true}
          configuredList={[]}
          onRemove={onRemove}
          isSupportList={true}
        />,
      )

      // Assert
      const connectBtn = screen.getByText('common.dataSource.connect')
      expect(connectBtn).toHaveClass('cursor-default opacity-50 grayscale')
    })

    it('should render Notion panel when configured with list of items', () => {
      // Act
      render(
        <Panel
          type={DataSourceType.notion}
          isConfigured={true}
          onConfigure={onConfigure}
          readOnly={false}
          configuredList={mockConfiguredList}
          onRemove={onRemove}
        />,
      )

      // Assert
      expect(screen.getByRole('button', { name: 'common.dataSource.configure' })).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.connectedWorkspace')).toBeInTheDocument()
      expect(screen.getByText('Item 1')).toBeInTheDocument()
      expect(screen.getByText('Item 2')).toBeInTheDocument()
    })

    it('should hide connect button for Notion if isSupportList is false', () => {
      // Act
      render(
        <Panel
          type={DataSourceType.notion}
          isConfigured={false}
          onConfigure={onConfigure}
          readOnly={false}
          configuredList={[]}
          onRemove={onRemove}
          isSupportList={false}
        />,
      )

      // Assert
      expect(screen.queryByText('common.dataSource.connect')).not.toBeInTheDocument()
    })

    it('should disable Notion configure button in readOnly mode (configured state)', () => {
      // Act
      render(
        <Panel
          type={DataSourceType.notion}
          isConfigured={true}
          onConfigure={onConfigure}
          readOnly={true}
          configuredList={mockConfiguredList}
          onRemove={onRemove}
        />,
      )

      // Assert
      const btn = screen.getByRole('button', { name: 'common.dataSource.configure' })
      expect(btn).toBeDisabled()
    })
  })

  describe('Website Panel Rendering', () => {
    it('should show correct provider names and handle configuration when not configured', () => {
      // Arrange
      const { rerender } = render(
        <Panel
          type={DataSourceType.website}
          provider={DataSourceProvider.fireCrawl}
          isConfigured={false}
          onConfigure={onConfigure}
          readOnly={false}
          configuredList={[]}
          onRemove={onRemove}
        />,
      )

      // Assert Firecrawl
      expect(screen.getByText('🔥 Firecrawl')).toBeInTheDocument()

      // Rerender for WaterCrawl
      rerender(
        <Panel
          type={DataSourceType.website}
          provider={DataSourceProvider.waterCrawl}
          isConfigured={false}
          onConfigure={onConfigure}
          readOnly={false}
          configuredList={[]}
          onRemove={onRemove}
        />,
      )
      expect(screen.getByText('WaterCrawl')).toBeInTheDocument()

      // Rerender for Jina Reader
      rerender(
        <Panel
          type={DataSourceType.website}
          provider={DataSourceProvider.jinaReader}
          isConfigured={false}
          onConfigure={onConfigure}
          readOnly={false}
          configuredList={[]}
          onRemove={onRemove}
        />,
      )
      expect(screen.getByText('Jina Reader')).toBeInTheDocument()

      // Act
      const configBtn = screen.getByText('common.dataSource.configure')
      fireEvent.click(configBtn)
      // Assert
      expect(onConfigure).toHaveBeenCalled()
    })

    it('should handle readOnly mode for Website configuration button', () => {
      // Act
      render(
        <Panel
          type={DataSourceType.website}
          isConfigured={false}
          onConfigure={onConfigure}
          readOnly={true}
          configuredList={[]}
          onRemove={onRemove}
        />,
      )

      // Assert
      const configBtn = screen.getByText('common.dataSource.configure')
      expect(configBtn).toHaveClass('cursor-default opacity-50 grayscale')

      // Act
      fireEvent.click(configBtn)
      // Assert
      expect(onConfigure).not.toHaveBeenCalled()
    })

    it('should render Website panel correctly when configured with crawlers', () => {
      // Act
      render(
        <Panel
          type={DataSourceType.website}
          isConfigured={true}
          onConfigure={onConfigure}
          readOnly={false}
          configuredList={mockConfiguredList}
          onRemove={onRemove}
        />,
      )

      // Assert
      expect(screen.getByText('common.dataSource.website.configuredCrawlers')).toBeInTheDocument()
      expect(screen.getByText('Item 1')).toBeInTheDocument()
      expect(screen.getByText('Item 2')).toBeInTheDocument()
    })
  })
})

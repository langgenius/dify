import type { ConfigItemType } from './config-item'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataSourceProvider } from '@/models/common'
import Panel from './index'
import { DataSourceType } from './types'

// Mock ConfigItem to isolate Panel testing
vi.mock('./config-item', () => ({
  default: ({ payload }: { payload: ConfigItemType }) => (
    <div data-testid="mock-config-item">{payload.name}</div>
  ),
}))

// Mock Button component
vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, className }: { children: React.ReactNode, onClick: () => void, disabled: boolean, className?: string }) => (
    <button
      data-testid="mock-button"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  ),
}))

describe('Panel Component', () => {
  const onConfigure = vi.fn()
  const onRemove = vi.fn()
  const mockConfiguredList: ConfigItemType[] = [
    { id: '1', name: 'Item 1', isActive: true, logo: () => null },
    { id: '2', name: 'Item 2', isActive: false, logo: () => null },
  ]

  beforeEach(() => {
    onConfigure.mockClear()
    onRemove.mockClear()
  })

  /**
   * Test case: Verify Notion Panel when not configured.
   * Covers:
   * - Notion type rendering (title, description)
   * - isSupportList = true shows "Connect" button
   * - onConfigure interaction
   */
  it('should render Notion panel correctly when not configured (isSupportList=true)', () => {
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

    expect(screen.getByText('common.dataSource.notion.title')).toBeInTheDocument()
    expect(screen.getByText('common.dataSource.notion.description')).toBeInTheDocument()

    const connectBtn = screen.getByText('common.dataSource.connect')
    expect(connectBtn).toBeInTheDocument()
    fireEvent.click(connectBtn)
    expect(onConfigure).toHaveBeenCalled()
  })

  /**
   * Test case: Verify Notion Panel in readOnly mode when not configured.
   * Covers:
   * - Connect button styling and cursor in readOnly mode.
   */
  it('should render Notion panel in readOnly mode when not configured', () => {
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

    const connectBtn = screen.getByText('common.dataSource.connect')
    expect(connectBtn).toHaveClass('cursor-default opacity-50 grayscale')
  })

  /**
   * Test case: Verify Notion Panel when configured.
   * Covers:
   * - "Configure" button rendering
   * - Configured list header
   * - ConfigItem rendering
   */
  it('should render Notion panel correctly when configured', () => {
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

    expect(screen.getByTestId('mock-button')).toHaveTextContent('common.dataSource.configure')
    expect(screen.getByText('common.dataSource.notion.connectedWorkspace')).toBeInTheDocument()

    const items = screen.getAllByTestId('mock-config-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Item 1')
  })

  /**
   * Test case: Verify Notion Panel without isSupportList.
   * Covers:
   * - Empty state when not configured and isSupportList is false.
   */
  it('should not show connect button for Notion if isSupportList is false', () => {
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

    expect(screen.queryByText('common.dataSource.connect')).not.toBeInTheDocument()
  })

  /**
   * Test case: Verify Website Panel when not configured with various providers.
   * Covers:
   * - Website title
   * - getProviderName logic (Firecrawl, WaterCrawl, Jina Reader)
   * - Website "Configure" button interaction
   */
  it('should render Website panel with correct provider names and handle configuration', () => {
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

    expect(screen.getByText('🔥 Firecrawl')).toBeInTheDocument()

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

    // Default case for getProviderName (fallback to Jina Reader)
    rerender(
      <Panel
        type={DataSourceType.website}
        isConfigured={false}
        onConfigure={onConfigure}
        readOnly={false}
        configuredList={[]}
        onRemove={onRemove}
      />,
    )
    expect(screen.getByText('Jina Reader')).toBeInTheDocument()

    const configBtn = screen.getByText('common.dataSource.configure')
    fireEvent.click(configBtn)
    expect(onConfigure).toHaveBeenCalled()
  })

  /**
   * Test case: Verify Website Panel in readOnly mode when not configured.
   * Covers:
   * - Website configure button behavior in readOnly mode.
   */
  it('should handle readOnly mode for Website configuration button', () => {
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

    const configBtn = screen.getByText('common.dataSource.configure')
    expect(configBtn).toHaveClass('cursor-default opacity-50 grayscale')

    // onClick should be undefined in readOnly mode, so clicking shouldn't trigger onConfigure
    fireEvent.click(configBtn)
    expect(onConfigure).not.toHaveBeenCalled()
  })

  /**
   * Test case: Verify Website Panel when configured.
   * Covers:
   * - Configured list header for website.
   */
  it('should render Website panel correctly when configured', () => {
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

    expect(screen.getByText('common.dataSource.website.configuredCrawlers')).toBeInTheDocument()
    expect(screen.getAllByTestId('mock-config-item')).toHaveLength(2)
  })

  /**
   * Test case: Verify that Notion configured button can be disabled by readOnly.
   */
  it('should disable Notion configure button in readOnly mode', () => {
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

    const btn = screen.getByTestId('mock-button')
    expect(btn).toBeDisabled()
  })
})

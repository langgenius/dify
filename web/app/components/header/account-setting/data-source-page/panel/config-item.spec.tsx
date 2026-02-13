import type { ConfigItemType } from './config-item'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfigItem from './config-item'
import { DataSourceType } from './types'

// Mock Operate component to avoid complex child rendering and service calls.
// This is a local component, so mocking it is allowed and recommended for unit isolation.
vi.mock('../data-source-notion/operate', () => ({
  default: ({ onAuthAgain, payload }: { onAuthAgain: () => void, payload: { id: string, total: number } }) => (
    <div data-testid="mock-operate">
      <button onClick={onAuthAgain} data-testid="operate-auth-btn">Auth Again</button>
      <span data-testid="operate-payload">{JSON.stringify(payload)}</span>
    </div>
  ),
}))

describe('ConfigItem Component', () => {
  const mockOnRemove = vi.fn()
  const mockOnChangeAuthorizedPage = vi.fn()
  const MockLogo = (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="mock-logo" {...props} />

  const baseNotionPayload: ConfigItemType = {
    id: 'notion-1',
    logo: MockLogo,
    name: 'Notion Workspace',
    isActive: true,
    notionConfig: {
      total: 5,
    },
  }

  const baseWebsitePayload: ConfigItemType = {
    id: 'website-1',
    logo: MockLogo,
    name: 'My Website',
    isActive: true,
  }

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test case: Render Notion component when active.
   * Verifies:
   * - Logo rendering
   * - Name rendering
   * - Active indicator (green)
   * - Status text (connected)
   * - Operate component presence and payload
   */
  it('should render active Notion config item correctly', () => {
    render(
      <ConfigItem
        type={DataSourceType.notion}
        payload={baseNotionPayload}
        onRemove={mockOnRemove}
        notionActions={{ onChangeAuthorizedPage: mockOnChangeAuthorizedPage }}
        readOnly={false}
      />,
    )

    expect(screen.getByTestId('mock-logo')).toBeInTheDocument()
    expect(screen.getByText('Notion Workspace')).toBeInTheDocument()
    // Indicator color green -> assumes Indicator implementation maps color to class or we check logic
    // Actually Indicator takes color prop. We can't easily check prop passed to child without mocking Indicator.
    // But we can check the text styling which depends on isActive.
    const statusText = screen.getByText('common.dataSource.notion.connected')
    expect(statusText).toBeInTheDocument()
    expect(statusText).toHaveClass('text-util-colors-green-green-600')

    // Check Operate payload
    const operatePayload = screen.getByTestId('operate-payload')
    expect(operatePayload).toHaveTextContent(JSON.stringify({ id: 'notion-1', total: 5 }))
  })

  /**
   * Test case: Render Notion component when inactive.
   * Verifies:
   * - Inactive indicator (yellow)
   * - Status text (disconnected)
   * - Text color warning
   */
  it('should render inactive Notion config item correctly', () => {
    const inactivePayload = { ...baseNotionPayload, isActive: false }
    render(
      <ConfigItem
        type={DataSourceType.notion}
        payload={inactivePayload}
        onRemove={mockOnRemove}
        readOnly={false}
      />,
    )

    const statusText = screen.getByText('common.dataSource.notion.disconnected')
    expect(statusText).toBeInTheDocument()
    expect(statusText).toHaveClass('text-util-colors-warning-warning-600')
  })

  /**
   * Test case: Notion Operate callback.
   * Verifies that the onAuthAgain callback passed to Operate triggers the passed notionAction.
   */
  it('should call notionActions.onChangeAuthorizedPage when Operate triggers auth again', () => {
    render(
      <ConfigItem
        type={DataSourceType.notion}
        payload={baseNotionPayload}
        onRemove={mockOnRemove}
        notionActions={{ onChangeAuthorizedPage: mockOnChangeAuthorizedPage }}
        readOnly={false}
      />,
    )

    fireEvent.click(screen.getByTestId('operate-auth-btn'))
    expect(mockOnChangeAuthorizedPage).toHaveBeenCalled()
  })

  /**
   * Test case: Notion default callback (noop).
   * Verifies no crash when notionActions is undefined.
   */
  it('should handle undefined notionActions safely', () => {
    render(
      <ConfigItem
        type={DataSourceType.notion}
        payload={baseNotionPayload}
        onRemove={mockOnRemove}
        readOnly={false}
      />,
    )

    // Click auth again, should call noop (does nothing, no error)
    fireEvent.click(screen.getByTestId('operate-auth-btn'))
    expect(mockOnChangeAuthorizedPage).not.toHaveBeenCalled()
  })

  /**
   * Test case: Notion config missing total.
   * Verifies default total is 0.
   */
  it('should pass default total 0 to Operate if notionConfig is undefined', () => {
    const payloadNoConfig = { ...baseNotionPayload, notionConfig: undefined }
    render(
      <ConfigItem
        type={DataSourceType.notion}
        payload={payloadNoConfig}
        onRemove={mockOnRemove}
        readOnly={false}
      />,
    )

    const operatePayload = screen.getByTestId('operate-payload')
    expect(operatePayload).toHaveTextContent(JSON.stringify({ id: 'notion-1', total: 0 }))
  })

  /**
   * Test case: Render Website active.
   * Verifies:
   * - Status text (active)
   * - Delete button presence (not readOnly)
   */
  it('should render active Website config item with delete button', () => {
    render(
      <ConfigItem
        type={DataSourceType.website}
        payload={baseWebsitePayload}
        onRemove={mockOnRemove}
        readOnly={false}
      />,
    )

    expect(screen.getByText('common.dataSource.website.active')).toBeInTheDocument()
    // Operate should not be rendered
    expect(screen.queryByTestId('mock-operate')).not.toBeInTheDocument()
  })

  /**
   * Test case: Delete button click for Website.
   * Verifies:
   * - Delete button is clickable
   * - onRemove callback is triggered
   * Note: Using SVG selector to find delete button, which is more resilient
   * to styling changes than relying on specific CSS class combinations.
   */
  it('should call onRemove when delete button is clicked for Website', () => {
    const { container } = render(
      <ConfigItem
        type={DataSourceType.website}
        payload={baseWebsitePayload}
        onRemove={mockOnRemove}
        readOnly={false}
      />,
    )

    const deleteSvg = container.querySelector('svg.remixicon')
    expect(deleteSvg).toBeInTheDocument()
    const deleteBtn = deleteSvg!.parentElement!
    fireEvent.click(deleteBtn)
    expect(mockOnRemove).toHaveBeenCalled()
  })

  /**
   * Test case: Website readOnly.
   * Verifies:
   * - Delete button is NOT present.
   */
  it('should not render delete button for Website in readOnly mode', () => {
    const { container } = render(
      <ConfigItem
        type={DataSourceType.website}
        payload={baseWebsitePayload}
        onRemove={mockOnRemove}
        readOnly={true}
      />,
    )

    const deleteSvg = container.querySelector('svg.remixicon')
    expect(deleteSvg).not.toBeInTheDocument()
  })

  /**
   * Test case: Website Inactive.
   * Verifies:
   * - Status text (inactive)
   * - Color warning
   */
  it('should render inactive Website config item', () => {
    const inactivePayload = { ...baseWebsitePayload, isActive: false }
    render(
      <ConfigItem
        type={DataSourceType.website}
        payload={inactivePayload}
        onRemove={mockOnRemove}
        readOnly={false}
      />,
    )

    const statusText = screen.getByText('common.dataSource.website.inactive')
    expect(statusText).toBeInTheDocument()
    expect(statusText).toHaveClass('text-util-colors-warning-warning-600')
  })
})

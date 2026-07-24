import type { ConfigItemType } from './config-item'
import { fireEvent, render, screen } from '@testing-library/react'
import ConfigItem from './config-item'
import { DataSourceType } from './types'

/**
 * ConfigItem Component Tests
 * Tests rendering of individual configuration items for Notion and Website data sources.
 */

// Mock Operate component to isolate ConfigItem unit tests.
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
    notionConfig: { total: 5 },
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

  describe('Notion Configuration', () => {
    it('should render active Notion config item with connected status and operator', () => {
      // Act
      render(
        <ConfigItem
          type={DataSourceType.notion}
          payload={baseNotionPayload}
          onRemove={mockOnRemove}
          notionActions={{ onChangeAuthorizedPage: mockOnChangeAuthorizedPage }}
          readOnly={false}
        />,
      )

      // Assert
      expect(screen.getByTestId('mock-logo')).toBeInTheDocument()
      expect(screen.getByText('Notion Workspace')).toBeInTheDocument()
      const statusText = screen.getByText('common.dataSource.notion.connected')
      expect(statusText).toHaveClass('text-util-colors-green-green-600')
      expect(screen.getByTestId('operate-payload')).toHaveTextContent(JSON.stringify({ id: 'notion-1', total: 5 }))
    })

    it('should render inactive Notion config item with disconnected status', () => {
      // Arrange
      const inactivePayload = { ...baseNotionPayload, isActive: false }

      // Act
      render(
        <ConfigItem
          type={DataSourceType.notion}
          payload={inactivePayload}
          onRemove={mockOnRemove}
          readOnly={false}
        />,
      )

      // Assert
      const statusText = screen.getByText('common.dataSource.notion.disconnected')
      expect(statusText).toHaveClass('text-util-colors-warning-warning-600')
    })

    it('should handle auth action through the Operate component', () => {
      // Arrange
      render(
        <ConfigItem
          type={DataSourceType.notion}
          payload={baseNotionPayload}
          onRemove={mockOnRemove}
          notionActions={{ onChangeAuthorizedPage: mockOnChangeAuthorizedPage }}
          readOnly={false}
        />,
      )

      // Act
      fireEvent.click(screen.getByTestId('operate-auth-btn'))

      // Assert
      expect(mockOnChangeAuthorizedPage).toHaveBeenCalled()
    })

    it('should fallback to 0 total if notionConfig is missing', () => {
      // Arrange
      const payloadNoConfig = { ...baseNotionPayload, notionConfig: undefined }

      // Act
      render(
        <ConfigItem
          type={DataSourceType.notion}
          payload={payloadNoConfig}
          onRemove={mockOnRemove}
          readOnly={false}
        />,
      )

      // Assert
      expect(screen.getByTestId('operate-payload')).toHaveTextContent(JSON.stringify({ id: 'notion-1', total: 0 }))
    })

    it('should handle missing notionActions safely without crashing', () => {
      // Arrange
      render(
        <ConfigItem
          type={DataSourceType.notion}
          payload={baseNotionPayload}
          onRemove={mockOnRemove}
          readOnly={false}
        />,
      )

      // Act & Assert
      expect(() => fireEvent.click(screen.getByTestId('operate-auth-btn'))).not.toThrow()
    })
  })

  describe('Website Configuration', () => {
    it('should render active Website config item and hide operator', () => {
      // Act
      render(
        <ConfigItem
          type={DataSourceType.website}
          payload={baseWebsitePayload}
          onRemove={mockOnRemove}
          readOnly={false}
        />,
      )

      // Assert
      expect(screen.getByText('common.dataSource.website.active')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-operate')).not.toBeInTheDocument()
    })

    it('should render inactive Website config item', () => {
      // Arrange
      const inactivePayload = { ...baseWebsitePayload, isActive: false }

      // Act
      render(
        <ConfigItem
          type={DataSourceType.website}
          payload={inactivePayload}
          onRemove={mockOnRemove}
          readOnly={false}
        />,
      )

      // Assert
      const statusText = screen.getByText('common.dataSource.website.inactive')
      expect(statusText).toHaveClass('text-util-colors-warning-warning-600')
    })

    it('should show remove button and trigger onRemove when clicked (not read-only)', () => {
      // Arrange
      const { container } = render(
        <ConfigItem
          type={DataSourceType.website}
          payload={baseWebsitePayload}
          onRemove={mockOnRemove}
          readOnly={false}
        />,
      )

      // Note: This selector is brittle but necessary since the delete button lacks
      // accessible attributes (data-testid, aria-label). Ideally, the component should
      // be updated to include proper accessibility attributes.
      const deleteBtn = container.querySelector('div[class*="cursor-pointer"]') as HTMLElement

      // Act
      fireEvent.click(deleteBtn)

      // Assert
      expect(mockOnRemove).toHaveBeenCalled()
    })

    it('should hide remove button in read-only mode', () => {
      // Arrange
      const { container } = render(
        <ConfigItem
          type={DataSourceType.website}
          payload={baseWebsitePayload}
          onRemove={mockOnRemove}
          readOnly={true}
        />,
      )

      // Assert
      const deleteBtn = container.querySelector('div[class*="cursor-pointer"]')
      expect(deleteBtn).not.toBeInTheDocument()
    })
  })
})

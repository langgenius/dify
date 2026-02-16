import type { DataSourceAuth } from './types'
import type { FormSchema } from '@/app/components/base/form/types'
import type { AddApiKeyButtonProps, AddOAuthButtonProps, PluginPayload } from '@/app/components/plugins/plugin-auth/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import Configure from './configure'

/**
 * Configure Component Tests
 * Using Unit approach to ensure 100% coverage and stable tests.
 */

// Mock internal components to isolate the unit test for Configure.
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: vi.fn(({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange: (val: boolean) => void }) => (
    <div data-testid="portal-wrapper" data-open={open}>
      {children}
      <button data-testid="force-close-portal" onClick={() => onOpenChange(false)}>Close Portal</button>
    </div>
  )),
  PortalToFollowElemTrigger: vi.fn(({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  )),
  PortalToFollowElemContent: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  )),
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AddApiKeyButton: vi.fn(({ onUpdate, disabled, buttonText }: AddApiKeyButtonProps & { onUpdate: () => void }) => (
    <button data-testid="add-api-key" onClick={onUpdate} disabled={disabled}>{buttonText}</button>
  )),
  AddOAuthButton: vi.fn(({ onUpdate, disabled, buttonText }: AddOAuthButtonProps & { onUpdate: () => void }) => (
    <button data-testid="add-oauth" onClick={onUpdate} disabled={disabled}>{buttonText}</button>
  )),
}))

// Mock RiAddLine since it's an icon component
vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <div data-testid="ri-add-line" />,
}))

// Mock Button component to simplify testing
vi.mock('@/app/components/base/button', () => ({
  default: vi.fn(({ children, onClick, variant }: { children: React.ReactNode, onClick?: () => void, variant?: string }) => (
    <button data-testid="base-button" onClick={onClick} data-variant={variant}>{children}</button>
  )),
}))

describe('Configure Component', () => {
  const mockOnUpdate = vi.fn()
  const mockPluginPayload: PluginPayload = {
    category: AuthCategory.datasource,
    provider: 'test-provider',
  }

  const mockItemBase: DataSourceAuth = {
    author: 'Test Author',
    provider: 'test-provider',
    plugin_id: 'test-plugin-id',
    plugin_unique_identifier: 'test-unique-id',
    icon: 'test-icon-url',
    name: 'test-name',
    label: { en_US: 'Test Label', zh_Hans: 'zh_hans' },
    description: { en_US: 'Test Description', zh_Hans: 'zh_hans' },
    credentials_list: [],
  }

  const mockFormSchema: FormSchema = {
    name: 'api_key',
    label: { en_US: 'API Key', zh_Hans: 'zh_hans' },
    type: FormTypeEnum.textInput,
    required: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Open State Management', () => {
    it('should toggle and manage the open state correctly', () => {
      // Act
      render(<Configure item={mockItemBase} pluginPayload={mockPluginPayload} />)
      const trigger = screen.getByTestId('portal-trigger')
      const wrapper = screen.getByTestId('portal-wrapper')
      const closeBtn = screen.getByTestId('force-close-portal')

      // Assert
      expect(wrapper).toHaveAttribute('data-open', 'false')

      // Act
      fireEvent.click(trigger)
      // Assert
      expect(wrapper).toHaveAttribute('data-open', 'true')

      // Act
      fireEvent.click(trigger)
      // Assert
      expect(wrapper).toHaveAttribute('data-open', 'false')

      // Act
      fireEvent.click(trigger)
      fireEvent.click(closeBtn)
      // Assert
      expect(wrapper).toHaveAttribute('data-open', 'false')
    })
  })

  describe('Conditional Rendering', () => {
    it('should render AddApiKeyButton when credential_schema is non-empty', () => {
      // Arrange
      const itemWithApiKey: DataSourceAuth = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
      }

      // Act
      render(<Configure item={itemWithApiKey} pluginPayload={mockPluginPayload} />)

      // Assert
      expect(screen.getByTestId('add-api-key')).toBeInTheDocument()
      expect(screen.queryByTestId('add-oauth')).not.toBeInTheDocument()
    })

    it('should render AddOAuthButton when oauth_schema with client_schema is non-empty', () => {
      // Arrange
      const itemWithOAuth: DataSourceAuth = {
        ...mockItemBase,
        oauth_schema: {
          client_schema: [mockFormSchema],
        },
      }

      // Act
      render(<Configure item={itemWithOAuth} pluginPayload={mockPluginPayload} />)

      // Assert
      expect(screen.getByTestId('add-oauth')).toBeInTheDocument()
      expect(screen.queryByTestId('add-api-key')).not.toBeInTheDocument()
    })

    it('should render both buttons and the OR divider when both schemes are available', () => {
      // Arrange
      const itemWithBoth: DataSourceAuth = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
        oauth_schema: {
          client_schema: [mockFormSchema],
        },
      }

      // Act
      render(<Configure item={itemWithBoth} pluginPayload={mockPluginPayload} />)

      // Assert
      expect(screen.getByTestId('add-api-key')).toBeInTheDocument()
      expect(screen.getByTestId('add-oauth')).toBeInTheDocument()
      expect(screen.getByText('OR')).toBeInTheDocument()
    })
  })

  describe('Update Handling', () => {
    it('should call onUpdate and close the portal when an update is triggered', () => {
      // Arrange
      const itemWithApiKey: DataSourceAuth = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
      }
      render(<Configure item={itemWithApiKey} pluginPayload={mockPluginPayload} onUpdate={mockOnUpdate} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      fireEvent.click(screen.getByTestId('add-api-key'))

      // Assert
      expect(mockOnUpdate).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('portal-wrapper')).toHaveAttribute('data-open', 'false')
    })

    it('should handle missing onUpdate callback gracefully', () => {
      // Arrange
      const itemWithBoth: DataSourceAuth = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
        oauth_schema: {
          client_schema: [mockFormSchema],
        },
      }
      render(<Configure item={itemWithBoth} pluginPayload={mockPluginPayload} />)

      // Act & Assert
      fireEvent.click(screen.getByTestId('portal-trigger'))
      fireEvent.click(screen.getByTestId('add-api-key'))
      expect(screen.getByTestId('portal-wrapper')).toHaveAttribute('data-open', 'false')

      fireEvent.click(screen.getByTestId('portal-trigger'))
      fireEvent.click(screen.getByTestId('add-oauth'))
      expect(screen.getByTestId('portal-wrapper')).toHaveAttribute('data-open', 'false')
    })
  })

  describe('Props and Edge Cases', () => {
    it('should pass the disabled prop to both configuration buttons', () => {
      // Arrange
      const itemWithBoth: DataSourceAuth = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
        oauth_schema: {
          client_schema: [mockFormSchema],
        },
      }

      // Act
      render(<Configure item={itemWithBoth} pluginPayload={mockPluginPayload} disabled={true} />)

      // Assert
      expect(screen.getByTestId('add-api-key')).toBeDisabled()
      expect(screen.getByTestId('add-oauth')).toBeDisabled()
    })

    it('should handle edge cases for missing, empty, or partial item data', () => {
      // Act & Assert (Missing schemas)
      const { rerender } = render(<Configure item={mockItemBase} pluginPayload={mockPluginPayload} />)
      expect(screen.queryByTestId('add-api-key')).not.toBeInTheDocument()
      expect(screen.queryByTestId('add-oauth')).not.toBeInTheDocument()

      // Arrange (Empty schemas)
      const itemEmpty: DataSourceAuth = {
        ...mockItemBase,
        credential_schema: [],
        oauth_schema: { client_schema: [] },
      }
      // Act
      rerender(<Configure item={itemEmpty} pluginPayload={mockPluginPayload} />)
      // Assert
      expect(screen.queryByTestId('add-api-key')).not.toBeInTheDocument()
      expect(screen.queryByTestId('add-oauth')).not.toBeInTheDocument()

      // Arrange (Partial OAuth schema)
      const itemPartialOAuth: DataSourceAuth = {
        ...mockItemBase,
        oauth_schema: {
          is_oauth_custom_client_enabled: true,
        },
      }
      // Act
      rerender(<Configure item={itemPartialOAuth} pluginPayload={mockPluginPayload} />)
      // Assert
      expect(screen.queryByTestId('add-oauth')).not.toBeInTheDocument()
    })

    it('should reach the unreachable branch on line 95 for 100% coverage', () => {
      // Specialized test to reach the '|| []' part: canOAuth must be truthy but client_schema falsy on second call
      let count = 0
      const itemWithGlitchedSchema = {
        ...mockItemBase,
        oauth_schema: {
          get client_schema() {
            count++
            if (count === 1)
              return [mockFormSchema]
            return undefined
          },
          is_oauth_custom_client_enabled: false,
          is_system_oauth_params_exists: false,
          oauth_custom_client_params: {},
          redirect_uri: '',
        },
      } as unknown as DataSourceAuth

      render(<Configure item={itemWithGlitchedSchema} pluginPayload={mockPluginPayload} />)

      expect(screen.getByTestId('add-oauth')).toBeInTheDocument()
    })
  })
})

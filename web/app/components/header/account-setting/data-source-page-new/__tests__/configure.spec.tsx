import type {
  DatasourceOAuthSchemaResponse,
  DatasourceProviderAuthResponse,
  ProviderConfig,
} from '@dify/contracts/api/console/auth/types.gen'
import type {
  AddApiKeyButtonProps,
  AddOAuthButtonProps,
  PluginPayload,
} from '@/app/components/plugins/plugin-auth/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import Configure from '../configure'

// Mock plugin auth components to isolate the unit test for Configure.
vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AddApiKeyButton: vi.fn(
    ({ onUpdate, disabled, buttonText }: AddApiKeyButtonProps & { onUpdate: () => void }) => (
      <button onClick={onUpdate} disabled={disabled}>
        {buttonText}
      </button>
    ),
  ),
  AddOAuthButton: vi.fn(
    ({ onUpdate, disabled, buttonText, renderTrigger }: AddOAuthButtonProps) => {
      const [permissionOpen, setPermissionOpen] = React.useState(false)
      const handleSaveAndAuthorize = () => {
        onUpdate?.()
        setPermissionOpen(true)
      }
      const trigger = (
        <button onClick={handleSaveAndAuthorize} disabled={disabled}>
          {buttonText}
        </button>
      )

      return (
        <>
          {renderTrigger
            ? renderTrigger({
                disabled,
                isConfigured: false,
                onClick: handleSaveAndAuthorize,
                trigger,
              })
            : trigger}
          {permissionOpen && <div role="dialog" aria-label="Who can use" />}
        </>
      )
    },
  ),
}))

describe('Configure Component', () => {
  const mockOnUpdate = vi.fn()
  const mockPluginPayload: PluginPayload = {
    category: AuthCategory.datasource,
    provider: 'test-provider',
  }

  const mockItemBase: DatasourceProviderAuthResponse = {
    author: 'Test Author',
    provider: 'test-provider',
    plugin_id: 'test-plugin-id',
    plugin_unique_identifier: 'test-unique-id',
    icon: 'test-icon-url',
    name: 'test-name',
    label: { en_US: 'Test Label', zh_Hans: 'zh_hans' },
    description: { en_US: 'Test Description', zh_Hans: 'zh_hans' },
    credentials_list: [],
    credential_schema: [],
    oauth_schema: null,
  }

  const createOAuthSchema = (
    overrides: Partial<DatasourceOAuthSchemaResponse> = {},
  ): DatasourceOAuthSchemaResponse => ({
    client_schema: [],
    credentials_schema: [],
    is_oauth_custom_client_enabled: false,
    is_system_oauth_params_exists: false,
    oauth_custom_client_params: null,
    redirect_uri: '',
    ...overrides,
  })

  const mockFormSchema: ProviderConfig = {
    name: 'api_key',
    label: { en_US: 'API Key', zh_Hans: 'zh_hans' },
    type: FormTypeEnum.textInput,
    required: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Open State Management', () => {
    it('should toggle and manage the open state correctly', async () => {
      const user = userEvent.setup()
      const itemWithApiKey: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
      }
      render(<Configure item={itemWithApiKey} pluginPayload={mockPluginPayload} />)
      const trigger = screen.getByRole('button', { name: /dataSource.configure/i })
      expect(trigger).toHaveAccessibleName('common.dataSource.configure Test Label')

      expect(screen.queryByRole('button', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()

      await user.click(trigger)

      expect(screen.getByRole('button', { name: 'plugin.auth.addApi' })).toBeInTheDocument()

      await user.click(trigger)

      expect(screen.queryByRole('button', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()
    })
  })

  describe('Conditional Rendering', () => {
    it('should render AddApiKeyButton when credential_schema is non-empty', async () => {
      const user = userEvent.setup()
      const itemWithApiKey: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
      }

      render(<Configure item={itemWithApiKey} pluginPayload={mockPluginPayload} />)
      await user.click(screen.getByRole('button', { name: /dataSource.configure/i }))

      expect(screen.getByRole('button', { name: 'plugin.auth.addApi' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'plugin.auth.addOAuth' })).not.toBeInTheDocument()
    })

    it('should render AddOAuthButton when oauth_schema with client_schema is non-empty', async () => {
      const user = userEvent.setup()
      const itemWithOAuth: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        oauth_schema: createOAuthSchema({
          client_schema: [mockFormSchema],
        }),
      }

      render(<Configure item={itemWithOAuth} pluginPayload={mockPluginPayload} />)
      await user.click(screen.getByRole('button', { name: /dataSource.configure/i }))

      expect(screen.getByRole('button', { name: 'plugin.auth.addOAuth' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()
    })

    it('should render both buttons and the OR divider when both schemes are available', async () => {
      const user = userEvent.setup()
      const itemWithBoth: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
        oauth_schema: createOAuthSchema({
          client_schema: [mockFormSchema],
        }),
      }

      render(<Configure item={itemWithBoth} pluginPayload={mockPluginPayload} />)
      await user.click(screen.getByRole('button', { name: /dataSource.configure/i }))

      expect(screen.getByRole('button', { name: 'plugin.auth.addApi' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'plugin.auth.addOAuth' })).toBeInTheDocument()
      expect(screen.getByText('OR')).toBeInTheDocument()
    })
  })

  describe('Update Handling', () => {
    it('should keep the permission dialog mounted after the OAuth menu closes', async () => {
      const user = userEvent.setup()
      const itemWithOAuth: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        oauth_schema: createOAuthSchema({
          client_schema: [mockFormSchema],
        }),
      }
      render(
        <Configure
          item={itemWithOAuth}
          pluginPayload={mockPluginPayload}
          onUpdate={mockOnUpdate}
        />,
      )

      await user.click(screen.getByRole('button', { name: /dataSource.configure/i }))
      await user.click(screen.getByRole('button', { name: 'plugin.auth.addOAuth' }))

      expect(mockOnUpdate).toHaveBeenCalledOnce()
      expect(screen.queryByRole('button', { name: 'plugin.auth.addOAuth' })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Who can use' })).toBeInTheDocument()
    })

    it('should call onUpdate and close the portal when an update is triggered', async () => {
      const user = userEvent.setup()
      const itemWithApiKey: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
      }
      render(
        <Configure
          item={itemWithApiKey}
          pluginPayload={mockPluginPayload}
          onUpdate={mockOnUpdate}
        />,
      )

      await user.click(screen.getByRole('button', { name: /dataSource.configure/i }))
      await user.click(screen.getByRole('button', { name: 'plugin.auth.addApi' }))

      expect(mockOnUpdate).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()
    })
  })

  describe('Props and Edge Cases', () => {
    it('should pass the disabled prop to both configuration buttons', async () => {
      const user = userEvent.setup()
      const itemWithBoth: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        credential_schema: [mockFormSchema],
        oauth_schema: createOAuthSchema({
          client_schema: [mockFormSchema],
        }),
      }

      render(<Configure item={itemWithBoth} pluginPayload={mockPluginPayload} disabled={true} />)
      await user.click(screen.getByRole('button', { name: /dataSource.configure/i }))

      expect(screen.getByRole('button', { name: 'plugin.auth.addApi' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'plugin.auth.addOAuth' })).toBeDisabled()
    })

    it('should handle edge cases for missing, empty, or partial item data', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <Configure item={mockItemBase} pluginPayload={mockPluginPayload} />,
      )
      await user.click(screen.getByRole('button', { name: /dataSource.configure/i }))
      expect(screen.queryByRole('button', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'plugin.auth.addOAuth' })).not.toBeInTheDocument()

      const itemEmpty: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        credential_schema: [],
        oauth_schema: createOAuthSchema({ client_schema: [] }),
      }

      rerender(<Configure item={itemEmpty} pluginPayload={mockPluginPayload} />)

      expect(screen.queryByRole('button', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'plugin.auth.addOAuth' })).not.toBeInTheDocument()

      const itemPartialOAuth: DatasourceProviderAuthResponse = {
        ...mockItemBase,
        oauth_schema: createOAuthSchema({
          is_oauth_custom_client_enabled: true,
        }),
      }

      rerender(<Configure item={itemPartialOAuth} pluginPayload={mockPluginPayload} />)

      expect(screen.queryByRole('button', { name: 'plugin.auth.addOAuth' })).not.toBeInTheDocument()
    })
  })
})

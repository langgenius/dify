import type { Credential, ModelProvider } from '../../../declarations'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../../declarations'
import ApiKeySection from '../api-key-section'

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  }))
})

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  credential_id: 'cred-1',
  credential_name: 'Test API Key',
  ...overrides,
})

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'test-provider',
  label: { en_US: 'Test provider', zh_Hans: 'Test provider' },
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [ConfigurationMethodEnum.predefinedModel],
  allow_custom_token: true,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    available_credentials: [],
  },
  system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  ...overrides,
})

describe('ApiKeySection', () => {
  const handlers = {
    onItemClick: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAdd: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Empty state
  describe('Empty state (no credentials)', () => {
    it('should call onAdd when Add API Key is clicked', async () => {
      const user = userEvent.setup()
      render(
        <ApiKeySection
          provider={createProvider()}
          credentials={[]}
          selectedCredentialId={undefined}
          {...handlers}
        />,
      )

      expect(screen.getByText(/noApiKeysTitle/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /addApiKey/ }))

      expect(handlers.onAdd).toHaveBeenCalledTimes(1)
    })

    it('should hide Add API Key button when allow_custom_token is false', () => {
      render(
        <ApiKeySection
          provider={createProvider({ allow_custom_token: false })}
          credentials={[]}
          selectedCredentialId={undefined}
          {...handlers}
        />,
      )

      expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
    })
  })

  // With credentials
  describe('With credentials', () => {
    const credentials = [
      createCredential({ credential_id: 'cred-1', credential_name: 'Key Alpha' }),
      createCredential({ credential_id: 'cred-2', credential_name: 'Key Beta' }),
    ]

    it('selects an existing credential and blocks selection while activation is pending', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <ApiKeySection
          provider={createProvider()}
          credentials={credentials}
          selectedCredentialId="cred-1"
          {...handlers}
        />,
      )
      expect(screen.getByRole('button', { name: 'Key Alpha' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await user.click(screen.getByRole('button', { name: 'Key Beta' }))
      expect(handlers.onItemClick).toHaveBeenCalledExactlyOnceWith(credentials[1])
      rerender(
        <ApiKeySection
          provider={createProvider()}
          credentials={credentials}
          selectedCredentialId="cred-1"
          isActivating
          {...handlers}
        />,
      )
      const beta = screen.getByRole('button', { name: 'Key Beta' })
      expect(beta).toBeDisabled()
      await user.click(beta)
      expect(handlers.onItemClick).toHaveBeenCalledTimes(1)
    })

    it('should hide Add API Key when allow_custom_token is false', () => {
      render(
        <ApiKeySection
          provider={createProvider({ allow_custom_token: false })}
          credentials={credentials}
          selectedCredentialId="cred-1"
          {...handlers}
        />,
      )

      expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
    })
  })
})

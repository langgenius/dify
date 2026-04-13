import type { Credential, ModelProvider } from '../../../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { CustomConfigurationStatusEnum, PreferredProviderTypeEnum } from '../../../declarations'
import ApiKeySection from '../api-key-section'

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  credential_id: 'cred-1',
  credential_name: 'Test API Key',
  ...overrides,
})

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'test-provider',
  allow_custom_token: true,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    available_credentials: [],
  },
  system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  ...overrides,
} as unknown as ModelProvider)

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
    it('should show empty state message', () => {
      render(
        <ApiKeySection
          provider={createProvider()}
          credentials={[]}
          selectedCredentialId={undefined}
          {...handlers}
        />,
      )

      expect(screen.getByText(/noApiKeysTitle/)).toBeInTheDocument()
      expect(screen.getByText(/noApiKeysDescription/)).toBeInTheDocument()
    })

    it('should show Add API Key button', () => {
      render(
        <ApiKeySection
          provider={createProvider()}
          credentials={[]}
          selectedCredentialId={undefined}
          {...handlers}
        />,
      )

      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should call onAdd when Add API Key is clicked', () => {
      render(
        <ApiKeySection
          provider={createProvider()}
          credentials={[]}
          selectedCredentialId={undefined}
          {...handlers}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /addApiKey/ }))

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

    it('should render credential list with header', () => {
      render(
        <ApiKeySection
          provider={createProvider()}
          credentials={credentials}
          selectedCredentialId="cred-1"
          {...handlers}
        />,
      )

      expect(screen.getByText(/apiKeys/)).toBeInTheDocument()
      expect(screen.getByText('Key Alpha')).toBeInTheDocument()
      expect(screen.getByText('Key Beta')).toBeInTheDocument()
    })

    it('should show Add API Key button in footer', () => {
      render(
        <ApiKeySection
          provider={createProvider()}
          credentials={credentials}
          selectedCredentialId="cred-1"
          {...handlers}
        />,
      )

      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
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

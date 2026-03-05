import type { CredentialPanelState } from '../use-credential-panel-state'
import type { ModelProvider } from '../../declarations'
import { render, screen } from '@testing-library/react'
import { CustomConfigurationStatusEnum, PreferredProviderTypeEnum } from '../../declarations'
import ModelAuthDropdown from './index'

vi.mock('../../model-auth/hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: vi.fn(),
    closeConfirmDelete: vi.fn(),
    doingAction: false,
    handleActiveCredential: vi.fn(),
    handleConfirmDelete: vi.fn(),
    deleteCredentialId: null,
    handleOpenModal: vi.fn(),
  }),
}))

const createProvider = (): ModelProvider => ({
  provider: 'test',
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    available_credentials: [],
  },
  system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
  preferred_provider_type: PreferredProviderTypeEnum.system,
} as unknown as ModelProvider)

const createState = (overrides: Partial<CredentialPanelState> = {}): CredentialPanelState => ({
  variant: 'credits-active',
  priority: 'credits',
  supportsCredits: true,
  showPrioritySwitcher: false,
  hasCredentials: false,
  isCreditsExhausted: false,
  credentialName: undefined,
  credits: 100,
  ...overrides,
})

describe('ModelAuthDropdown', () => {
  const onChangePriority = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Button text based on variant
  describe('Button configuration', () => {
    it('should show "Add API Key" when no credentials and non-accent variant', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: false, variant: 'credits-active' })}
          onChangePriority={onChangePriority}
        />,
      )

      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should show "Configure" when has credentials and non-accent variant', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          onChangePriority={onChangePriority}
        />,
      )

      expect(screen.getByRole('button', { name: /config/ })).toBeInTheDocument()
    })

    it('should show "Add API Key" for api-required-add variant with accent style', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-add', hasCredentials: false })}
          onChangePriority={onChangePriority}
        />,
      )

      const button = screen.getByRole('button', { name: /addApiKey/ })
      expect(button).toBeInTheDocument()
    })

    it('should show "Configure" for api-required-configure variant with accent style', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-configure', hasCredentials: true })}
          onChangePriority={onChangePriority}
        />,
      )

      expect(screen.getByRole('button', { name: /config/ })).toBeInTheDocument()
    })
  })
})

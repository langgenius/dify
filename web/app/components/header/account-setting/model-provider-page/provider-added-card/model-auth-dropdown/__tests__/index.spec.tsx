import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomConfigurationStatusEnum, PreferredProviderTypeEnum } from '../../../declarations'
import ModelAuthDropdown from '../index'

vi.mock('../../../model-auth/hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: vi.fn(),
    closeConfirmDelete: vi.fn(),
    doingAction: false,
    handleConfirmDelete: vi.fn(),
    deleteCredentialId: null,
    handleOpenModal: vi.fn(),
  }),
}))

vi.mock('../use-activate-credential', () => ({
  useActivateCredential: () => ({
    selectedCredentialId: undefined,
    isActivating: false,
    activate: vi.fn(),
  }),
}))

vi.mock('../../use-trial-credits', () => ({
  useTrialCredits: () => ({ credits: 0, totalCredits: 10_000, isExhausted: true, isLoading: false }),
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'test',
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    available_credentials: [],
  },
  system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  ...overrides,
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

  describe('Button text', () => {
    it('should show "Add API Key" when no credentials for credits-active', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: false, variant: 'credits-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should show "Configure" when has credentials for api-active', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Add API Key" for api-required-add variant', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-add', hasCredentials: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should show "Configure" for api-required-configure variant', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-configure', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Configure" for credits-active when has credentials', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: true, variant: 'credits-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Add API Key" for credits-exhausted (no credentials)', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'credits-exhausted', hasCredentials: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should show "Configure" for api-unavailable (has credentials)', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-unavailable', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Configure" for api-fallback (has credentials)', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-fallback', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })
  })

  describe('Button variant styling', () => {
    it('should use primary for api-required-add', () => {
      const { container } = render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-add', hasCredentials: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const button = container.querySelector('button')
      expect(button?.getAttribute('data-variant') ?? button?.className).toMatch(/primary/)
    })

    it('should use secondary-accent for api-required-configure', () => {
      const { container } = render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-configure', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const button = container.querySelector('button')
      expect(button?.getAttribute('data-variant') ?? button?.className).toMatch(/accent/)
    })
  })

  describe('Popover behavior', () => {
    it('should open popover on button click and show dropdown content', async () => {
      render(
        <ModelAuthDropdown
          provider={createProvider({
            custom_configuration: {
              status: CustomConfigurationStatusEnum.active,
              available_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
              current_credential_id: 'c1',
              current_credential_name: 'Key 1',
            },
          })}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /config/i }))

      await waitFor(() => {
        expect(screen.getByText('Key 1')).toBeInTheDocument()
      })
    })
  })
})

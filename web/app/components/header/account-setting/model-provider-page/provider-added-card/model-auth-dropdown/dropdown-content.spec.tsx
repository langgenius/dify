import type { CredentialPanelState } from '../use-credential-panel-state'
import type { ModelProvider } from '../../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { CustomConfigurationStatusEnum, PreferredProviderTypeEnum } from '../../declarations'
import DropdownContent from './dropdown-content'

const mockHandleOpenModal = vi.fn()
const mockHandleActiveCredential = vi.fn()
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()
let mockDeleteCredentialId: string | null = null

vi.mock('../use-trial-credits', () => ({
  useTrialCredits: () => ({ credits: 0, isExhausted: true, isLoading: false }),
}))

vi.mock('../../model-auth/hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: mockCloseConfirmDelete,
    doingAction: false,
    handleActiveCredential: mockHandleActiveCredential,
    handleConfirmDelete: mockHandleConfirmDelete,
    deleteCredentialId: mockDeleteCredentialId,
    handleOpenModal: mockHandleOpenModal,
  }),
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'test',
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    current_credential_id: 'cred-1',
    current_credential_name: 'My Key',
    available_credentials: [
      { credential_id: 'cred-1', credential_name: 'My Key' },
      { credential_id: 'cred-2', credential_name: 'Other Key' },
    ],
  },
  system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  configurate_methods: ['predefined-model'],
  supported_model_types: ['llm'],
  ...overrides,
} as unknown as ModelProvider)

const createState = (overrides: Partial<CredentialPanelState> = {}): CredentialPanelState => ({
  variant: 'api-active',
  priority: 'apiKey',
  supportsCredits: true,
  showPrioritySwitcher: true,
  hasCredentials: true,
  isCreditsExhausted: false,
  credentialName: 'My Key',
  credits: 100,
  ...overrides,
})

describe('DropdownContent', () => {
  const onChangePriority = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteCredentialId = null
  })

  // Conditional sections rendering
  describe('Conditional sections', () => {
    it('should show UsagePrioritySection when showPrioritySwitcher is true', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ showPrioritySwitcher: true })}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.getByText(/usagePriority/)).toBeInTheDocument()
    })

    it('should hide UsagePrioritySection when showPrioritySwitcher is false', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ showPrioritySwitcher: false })}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.queryByText(/usagePriority/)).not.toBeInTheDocument()
    })

    it('should show CreditsExhaustedAlert when credits exhausted and supports credits', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ isCreditsExhausted: true, supportsCredits: true })}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.getAllByText(/creditsExhausted/).length).toBeGreaterThan(0)
    })

    it('should hide CreditsExhaustedAlert when credits not exhausted', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ isCreditsExhausted: false })}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.queryByText(/creditsExhausted/)).not.toBeInTheDocument()
    })
  })

  // API key section
  describe('API key section', () => {
    it('should render credential items', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.getByText('My Key')).toBeInTheDocument()
      expect(screen.getByText('Other Key')).toBeInTheDocument()
    })

    it('should show empty state when no credentials', () => {
      render(
        <DropdownContent
          provider={createProvider({
            custom_configuration: {
              status: CustomConfigurationStatusEnum.noConfigure,
              available_credentials: [],
            },
          })}
          state={createState({ hasCredentials: false })}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.getByText(/noApiKeysTitle/)).toBeInTheDocument()
    })
  })

  // Add API Key action
  describe('Add API Key', () => {
    it('should call handleOpenModal and onClose when adding API key', () => {
      render(
        <DropdownContent
          provider={createProvider({
            custom_configuration: {
              status: CustomConfigurationStatusEnum.noConfigure,
              available_credentials: [],
            },
          })}
          state={createState({ hasCredentials: false })}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /addApiKey/ }))

      expect(mockHandleOpenModal).toHaveBeenCalledWith()
      expect(onClose).toHaveBeenCalled()
    })
  })

  // Width constraint
  describe('Layout', () => {
    it('should have 320px width container', () => {
      const { container } = render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      const widthContainer = container.querySelector('.w-\\[320px\\]')
      expect(widthContainer).toBeTruthy()
    })
  })
})

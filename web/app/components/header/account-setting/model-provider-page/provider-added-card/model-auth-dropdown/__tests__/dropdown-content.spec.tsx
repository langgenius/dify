import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { fireEvent, render, screen } from '@testing-library/react'
import { CustomConfigurationStatusEnum, PreferredProviderTypeEnum } from '../../../declarations'
import DropdownContent from '../dropdown-content'

const mockHandleOpenModal = vi.fn()
const mockActivate = vi.fn()
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()
let mockDeleteCredentialId: string | null = null

vi.mock('../../use-trial-credits', () => ({
  useTrialCredits: () => ({ credits: 0, totalCredits: 10_000, isExhausted: true, isLoading: false }),
}))

vi.mock('../use-activate-credential', () => ({
  useActivateCredential: () => ({
    selectedCredentialId: 'cred-1',
    isActivating: false,
    activate: mockActivate,
  }),
}))

vi.mock('../../../model-auth/hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: mockCloseConfirmDelete,
    doingAction: false,
    handleConfirmDelete: mockHandleConfirmDelete,
    deleteCredentialId: mockDeleteCredentialId,
    handleOpenModal: mockHandleOpenModal,
  }),
}))

vi.mock('../../../model-auth/authorized/credential-item', () => ({
  default: ({ credential, onItemClick, onEdit, onDelete }: {
    credential: { credential_id: string, credential_name: string }
    onItemClick?: (c: unknown) => void
    onEdit?: (c: unknown) => void
    onDelete?: (c: unknown) => void
  }) => (
    <div data-testid={`credential-${credential.credential_id}`}>
      <span>{credential.credential_name}</span>
      <button data-testid={`click-${credential.credential_id}`} onClick={() => onItemClick?.(credential)}>select</button>
      <button data-testid={`edit-${credential.credential_id}`} onClick={() => onEdit?.(credential)}>edit</button>
      <button data-testid={`delete-${credential.credential_id}`} onClick={() => onDelete?.(credential)}>delete</button>
    </div>
  ),
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

  describe('UsagePrioritySection visibility', () => {
    it('should show when showPrioritySwitcher is true', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ showPrioritySwitcher: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getByText(/usagePriority/)).toBeInTheDocument()
    })

    it('should hide when showPrioritySwitcher is false', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ showPrioritySwitcher: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.queryByText(/usagePriority/)).not.toBeInTheDocument()
    })
  })

  describe('CreditsExhaustedAlert', () => {
    it('should show when credits exhausted and supports credits', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ isCreditsExhausted: true, supportsCredits: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getAllByText(/creditsExhausted/).length).toBeGreaterThan(0)
    })

    it('should hide when credits not exhausted', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ isCreditsExhausted: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.queryByText(/creditsExhausted/)).not.toBeInTheDocument()
    })

    it('should hide when credits exhausted but supportsCredits is false', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({ isCreditsExhausted: true, supportsCredits: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.queryByText(/creditsExhausted/)).not.toBeInTheDocument()
    })

    it('should show fallback message when api-fallback variant with exhausted credits', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({
            variant: 'api-fallback',
            isCreditsExhausted: true,
            supportsCredits: true,
            priority: 'credits',
          })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getAllByText(/creditsExhaustedFallback/).length).toBeGreaterThan(0)
    })

    it('should show non-fallback message when credits-exhausted variant', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({
            variant: 'credits-exhausted',
            isCreditsExhausted: true,
            supportsCredits: true,
            hasCredentials: false,
            priority: 'credits',
          })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getByText(/creditsExhaustedMessage/)).toBeInTheDocument()
    })
  })

  describe('CreditsFallbackAlert', () => {
    it('should show when priority is apiKey, supports credits, not exhausted, and variant is not api-active', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({
            variant: 'api-required-add',
            priority: 'apiKey',
            supportsCredits: true,
            isCreditsExhausted: false,
            hasCredentials: false,
          })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getByText(/noApiKeysFallback/)).toBeInTheDocument()
    })

    it('should show unavailable message when priority is apiKey with credentials but not api-active', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({
            variant: 'api-unavailable',
            priority: 'apiKey',
            supportsCredits: true,
            isCreditsExhausted: false,
            hasCredentials: true,
          })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getAllByText(/apiKeyUnavailableFallback/).length).toBeGreaterThan(0)
    })

    it('should NOT show when variant is api-active', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({
            variant: 'api-active',
            priority: 'apiKey',
            supportsCredits: true,
            isCreditsExhausted: false,
          })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.queryByText(/noApiKeysFallback/)).not.toBeInTheDocument()
      expect(screen.queryByText(/apiKeyUnavailableFallback/)).not.toBeInTheDocument()
    })

    it('should NOT show when priority is credits', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState({
            variant: 'credits-active',
            priority: 'credits',
            supportsCredits: true,
            isCreditsExhausted: false,
          })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.queryByText(/noApiKeysFallback/)).not.toBeInTheDocument()
      expect(screen.queryByText(/apiKeyUnavailableFallback/)).not.toBeInTheDocument()
    })
  })

  describe('API key section', () => {
    it('should render all credential items', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
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
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getByText(/noApiKeysTitle/)).toBeInTheDocument()
      expect(screen.getByText(/noApiKeysDescription/)).toBeInTheDocument()
    })

    it('should call activate without closing on credential item click', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      fireEvent.click(screen.getByTestId('click-cred-2'))

      expect(mockActivate).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'cred-2' }),
      )
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should call handleOpenModal and close on edit credential', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      fireEvent.click(screen.getByTestId('edit-cred-2'))

      expect(mockHandleOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'cred-2' }),
      )
      expect(onClose).toHaveBeenCalled()
    })

    it('should call openConfirmDelete on delete credential', () => {
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      fireEvent.click(screen.getByTestId('delete-cred-2'))

      expect(mockOpenConfirmDelete).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'cred-2' }),
      )
    })
  })

  describe('Add API Key', () => {
    it('should call handleOpenModal with no args and close on add', () => {
      render(
        <DropdownContent
          provider={createProvider({
            custom_configuration: {
              status: CustomConfigurationStatusEnum.noConfigure,
              available_credentials: [],
            },
          })}
          state={createState({ hasCredentials: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /addApiKey/ }))

      expect(mockHandleOpenModal).toHaveBeenCalledWith()
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('AlertDialog for delete confirmation', () => {
    it('should show confirm dialog when deleteCredentialId is set', () => {
      mockDeleteCredentialId = 'cred-1'
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.getByText(/confirmDelete/)).toBeInTheDocument()
    })

    it('should not show confirm dialog when deleteCredentialId is null', () => {
      mockDeleteCredentialId = null
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(screen.queryByText(/confirmDelete/)).not.toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('should have 320px width container', () => {
      const { container } = render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      expect(container.querySelector('.w-\\[320px\\]')).toBeTruthy()
    })
  })
})

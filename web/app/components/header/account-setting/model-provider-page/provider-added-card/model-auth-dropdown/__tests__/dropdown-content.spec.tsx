import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createDeferred } from '@/test/deferred'
import { CustomConfigurationStatusEnum, PreferredProviderTypeEnum } from '../../../declarations'
import DropdownContent from '../dropdown-content'

const mockHandleOpenModal = vi.fn()
const { mockSwitchCredential, mockUpdateProviders, mockUpdateModels } = vi.hoisted(() => ({
  mockSwitchCredential: vi.fn(),
  mockUpdateProviders: vi.fn(),
  mockUpdateModels: vi.fn(),
}))
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()
let mockDeleteCredentialId: string | null = null
let mockWorkspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage']

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.credentials.switch.post': (input) =>
        mockSwitchCredential(input),
    }),
  }
})
vi.mock('../../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks')>()),
  useUpdateModelProviders: () => mockUpdateProviders,
  useUpdateModelList: () => mockUpdateModels,
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

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
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
  }) as unknown as ModelProvider

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
    mockSwitchCredential.mockReset().mockResolvedValue({ result: 'success' })
    mockDeleteCredentialId = null
    mockWorkspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage']
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

    it('should call activate without closing on credential item click', async () => {
      const user = userEvent.setup()
      const pending = createDeferred<{ result: string }>()
      mockSwitchCredential.mockReturnValueOnce(pending.promise)
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Other Key' }))

      expect(mockSwitchCredential).toHaveBeenCalledExactlyOnceWith({
        params: { provider: 'test' },
        body: { credential_id: 'cred-2' },
      })
      expect(screen.getByRole('button', { name: 'Other Key' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'My Key' })).toBeDisabled()
      expect(mockUpdateProviders).not.toHaveBeenCalled()
      await act(async () => pending.resolve({ result: 'success' }))
      await waitFor(() => expect(mockUpdateProviders).toHaveBeenCalledTimes(1))
      expect(mockUpdateModels).toHaveBeenCalledExactlyOnceWith('llm')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should call handleOpenModal and close on edit credential', async () => {
      const user = userEvent.setup()
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      await user.click(
        within(screen.getByText('Other Key').closest('.group')!).getByRole('button', {
          name: 'common.operation.edit',
        }),
      )

      expect(mockHandleOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'cred-2' }),
      )
      expect(onClose).toHaveBeenCalled()
    })

    it('should call openConfirmDelete on delete credential', async () => {
      const user = userEvent.setup()
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      await user.click(
        within(screen.getByText('Other Key').closest('.group')!).getByRole('button', {
          name: 'common.operation.delete',
        }),
      )

      expect(mockOpenConfirmDelete).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'cred-2' }),
      )
    })

    it('should allow use-only users to switch credentials but not edit or delete them', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['credential.use']

      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Other Key' }))
      expect(
        screen.queryByRole('button', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.delete' }),
      ).not.toBeInTheDocument()

      expect(mockSwitchCredential).toHaveBeenCalledExactlyOnceWith({
        params: { provider: 'test' },
        body: { credential_id: 'cred-2' },
      })
      expect(mockHandleOpenModal).not.toHaveBeenCalled()
      expect(mockOpenConfirmDelete).not.toHaveBeenCalled()
    })

    it('should allow create-only users to add credentials but not switch, edit, or delete existing credentials', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['credential.create']

      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.queryByRole('button', { name: 'Other Key' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.delete' }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /addApiKey/ }))

      expect(mockSwitchCredential).not.toHaveBeenCalled()
      expect(mockOpenConfirmDelete).not.toHaveBeenCalled()
      expect(mockHandleOpenModal).toHaveBeenCalledTimes(1)
      expect(mockHandleOpenModal).toHaveBeenCalledWith()
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should allow manage-only users to edit and delete credentials but not switch or add them', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['credential.manage']

      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )

      expect(screen.queryByRole('button', { name: 'Other Key' })).not.toBeInTheDocument()
      await user.click(
        within(screen.getByText('Other Key').closest('.group')!).getByRole('button', {
          name: 'common.operation.edit',
        }),
      )
      await user.click(
        within(screen.getByText('Other Key').closest('.group')!).getByRole('button', {
          name: 'common.operation.delete',
        }),
      )

      expect(mockSwitchCredential).not.toHaveBeenCalled()
      expect(mockHandleOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'cred-2' }),
      )
      expect(mockOpenConfirmDelete).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'cred-2' }),
      )
      expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
    })
  })

  it.each(['cancel', 'delete'] as const)(
    'routes the delete confirmation %s action',
    async (action) => {
      const user = userEvent.setup()
      mockDeleteCredentialId = 'cred-2'
      render(
        <DropdownContent
          provider={createProvider()}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
          onClose={onClose}
        />,
      )
      const dialog = screen.getByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: `common.operation.${action}` }))
      expect(
        action === 'cancel' ? mockCloseConfirmDelete : mockHandleConfirmDelete,
      ).toHaveBeenCalledTimes(1)
      expect(
        action === 'cancel' ? mockHandleConfirmDelete : mockCloseConfirmDelete,
      ).not.toHaveBeenCalled()
    },
  )

  describe('Add API Key', () => {
    it('should call handleOpenModal with no args and close on add', async () => {
      const user = userEvent.setup()
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

      await user.click(screen.getByRole('button', { name: /addApiKey/ }))

      expect(mockHandleOpenModal).toHaveBeenCalledWith()
      expect(onClose).toHaveBeenCalled()
    })

    it('should hide add action for use-only users', () => {
      mockWorkspacePermissionKeys = ['credential.use']

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

      expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
    })
  })
})

function render(ui: React.ReactElement) {
  const { wrapper: QueryWrapper, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(), {
    exhausted_at: null,
    next_credit_reset_date: null,
    pool_type: 'paid',
    remaining_credits: 0,
    model_billing_source: 'legacy_message_credits',
    model_billing_migration_status: 'none',
    quota_limit: 10_000,
    quota_used: 10_000,
    is_exhausted: true,
    is_unlimited: false,
  })
  return renderWithConsoleState(ui, {
    wrapper: ({ children }) => (
      <NuqsTestingAdapter>
        <QueryWrapper>{children}</QueryWrapper>
      </NuqsTestingAdapter>
    ),
  })
}

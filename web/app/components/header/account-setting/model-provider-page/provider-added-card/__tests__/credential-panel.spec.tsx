import type { ModelProvider } from '../../declarations'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import CredentialPanel from '../credential-panel'

const {
  mockToastNotify,
  mockUpdateModelList,
  mockUpdateModelProviders,
  mockTrialCredits,
  mockChangePriorityFn,
} = vi.hoisted(() => ({
  mockToastNotify: vi.fn(),
  mockUpdateModelList: vi.fn(),
  mockUpdateModelProviders: vi.fn(),
  mockTrialCredits: {
    credits: 100,
    totalCredits: 10_000,
    isExhausted: false,
    isLoading: false,
    nextCreditResetDate: undefined,
  },
  mockChangePriorityFn: vi.fn().mockResolvedValue({ result: 'success' }),
}))

vi.mock('@/app/notifications', () => ({
  default: { notify: mockToastNotify },
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.preferredProviderType.post': (input) =>
        mockChangePriorityFn(input),
    }),
  }
})

vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useUpdateModelList: () => mockUpdateModelList,
  useUpdateModelProviders: () => mockUpdateModelProviders,
}))

vi.mock('../use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

// Credential editing is covered in the auth flow; retain the real dropdown and priority controls.
vi.mock('../../model-auth/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../model-auth/hooks')>()),
  useAuth: () => ({
    openConfirmDelete: vi.fn(),
    closeConfirmDelete: vi.fn(),
    doingAction: false,
    handleConfirmDelete: vi.fn(),
    deleteCredentialId: null,
    handleOpenModal: vi.fn(),
  }),
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
    provider: 'langgenius/openai/openai',
    provider_credential_schema: { credential_form_schemas: [] },
    custom_configuration: {
      status: CustomConfigurationStatusEnum.active,
      current_credential_id: 'cred-1',
      current_credential_name: 'test-credential',
      available_credentials: [{ credential_id: 'cred-1', credential_name: 'test-credential' }],
    },
    system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
    preferred_provider_type: PreferredProviderTypeEnum.system,
    configurate_methods: [ConfigurationMethodEnum.predefinedModel],
    supported_model_types: ['llm'],
    ...overrides,
  }) as unknown as ModelProvider

const renderWithQueryClient = (provider: ModelProvider) => {
  return renderWithConsoleQuery(<CredentialPanel provider={provider} />, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    trialModels: ['langgenius/openai/openai'],
    workspacePermissionKeys: ['credential.use'],
  })
}

describe('CredentialPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChangePriorityFn.mockReset().mockResolvedValue({ result: 'success' })
    Object.assign(mockTrialCredits, {
      credits: 100,
      totalCredits: 10_000,
      isExhausted: false,
      isLoading: false,
    })
  })

  describe('Text label variants', () => {
    it('should show "AI credits in use" for credits-active variant', () => {
      renderWithQueryClient(createProvider())
      expect(screen.getByText(/aiCreditsInUse/)).toBeInTheDocument()
    })

    it('should show "Credits exhausted" for credits-exhausted variant (no credentials)', () => {
      mockTrialCredits.isExhausted = true
      mockTrialCredits.credits = 0
      renderWithQueryClient(
        createProvider({
          custom_configuration: {
            status: CustomConfigurationStatusEnum.noConfigure,
            available_credentials: [],
          },
        }),
      )
      expect(screen.getByText(/quotaExhausted/)).toBeInTheDocument()
    })

    it('should show "No available usage" for no-usage variant (exhausted + credential unauthorized)', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(
        createProvider({
          custom_configuration: {
            status: CustomConfigurationStatusEnum.active,
            current_credential_id: undefined,
            current_credential_name: undefined,
            available_credentials: [{ credential_id: 'cred-1' }],
          },
        }),
      )
      expect(screen.getByText(/noAvailableUsage/)).toBeInTheDocument()
    })

    it('should show "AI credits in use" with warning for credits-fallback (custom priority, no credentials, credits available)', () => {
      renderWithQueryClient(
        createProvider({
          preferred_provider_type: PreferredProviderTypeEnum.custom,
          custom_configuration: {
            status: CustomConfigurationStatusEnum.noConfigure,
            available_credentials: [],
          },
        }),
      )
      expect(screen.getByText(/aiCreditsInUse/)).toBeInTheDocument()
    })

    it('should show "AI credits in use" with warning for credits-fallback (custom priority, credential unauthorized, credits available)', () => {
      renderWithQueryClient(
        createProvider({
          preferred_provider_type: PreferredProviderTypeEnum.custom,
          custom_configuration: {
            status: CustomConfigurationStatusEnum.active,
            current_credential_id: undefined,
            current_credential_name: undefined,
            available_credentials: [{ credential_id: 'cred-1' }],
          },
        }),
      )
      expect(screen.getByText(/aiCreditsInUse/)).toBeInTheDocument()
    })
  })

  describe('Status label variants', () => {
    it('should show credential name for api-fallback (exhausted + authorized key)', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider())
      expect(screen.getByText('test-credential')).toBeInTheDocument()
    })

    it('should show credential name for api-active (custom priority + authorized)', () => {
      renderWithQueryClient(
        createProvider({
          preferred_provider_type: PreferredProviderTypeEnum.custom,
        }),
      )
      expect(screen.getByText('test-credential')).toBeInTheDocument()
    })

    it('should show unavailable credential name for api-unavailable (exhausted + named unauthorized key)', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(
        createProvider({
          preferred_provider_type: PreferredProviderTypeEnum.custom,
          custom_configuration: {
            status: CustomConfigurationStatusEnum.active,
            current_credential_id: undefined,
            current_credential_name: 'Bad Key',
            available_credentials: [{ credential_id: 'cred-1', credential_name: 'Bad Key' }],
          },
        }),
      )
      expect(screen.getByText('Bad Key')).toBeInTheDocument()
    })
  })

  describe('apiKeyOnly priority (system disabled)', () => {
    it('should derive api-required-add when system config disabled and no credentials', () => {
      renderWithQueryClient(
        createProvider({
          system_configuration: {
            enabled: false,
            current_quota_type: CurrentSystemQuotaTypeEnum.trial,
            quota_configurations: [],
          },
          preferred_provider_type: PreferredProviderTypeEnum.system,
          custom_configuration: {
            status: CustomConfigurationStatusEnum.noConfigure,
            available_credentials: [],
          },
        }),
      )
      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
      expect(screen.getByText(/apiKeyRequired/)).toBeInTheDocument()
    })

    it('should derive api-active when system config disabled but has authorized key', () => {
      renderWithQueryClient(
        createProvider({
          system_configuration: {
            enabled: false,
            current_quota_type: CurrentSystemQuotaTypeEnum.trial,
            quota_configurations: [],
          },
        }),
      )
      expect(screen.getByText('test-credential')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.config' })).toBeInTheDocument()
    })
  })
  it('changes priority through the real dropdown and refreshes provider and model data', async () => {
    const user = userEvent.setup()
    const request = createDeferred<{ result: string }>()
    mockChangePriorityFn.mockReturnValueOnce(request.promise)
    renderWithQueryClient(createProvider())
    await user.click(screen.getByRole('button', { name: 'common.operation.config' }))
    const apiKey = screen.getByRole('button', { name: /apiKeyOption/ })
    await user.click(apiKey)
    expect(mockChangePriorityFn).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'langgenius/openai/openai' },
      body: { preferred_provider_type: 'custom' },
    })
    expect(apiKey).toBeDisabled()
    expect(mockUpdateModelProviders).not.toHaveBeenCalled()
    await act(async () => request.resolve({ result: 'success' }))
    await waitFor(() => expect(apiKey).toBeEnabled())
    expect(mockUpdateModelProviders).toHaveBeenCalledTimes(1)
    expect(mockUpdateModelList).toHaveBeenCalledExactlyOnceWith('llm')
  })

  it('keeps a failed priority change retryable without refreshing or duplicate feedback', async () => {
    const user = userEvent.setup()
    const request = createDeferred<{ result: string }>()
    mockChangePriorityFn.mockReturnValueOnce(request.promise)
    renderWithQueryClient(createProvider())
    await user.click(screen.getByRole('button', { name: 'common.operation.config' }))
    const apiKey = screen.getByRole('button', { name: /apiKeyOption/ })
    await user.click(apiKey)
    await waitFor(() => expect(apiKey).toBeDisabled())
    await act(async () => request.reject(new Error('Unavailable')))
    await waitFor(() => expect(apiKey).toBeEnabled())
    // The service-boundary stub bypasses the transport's own error feedback.
    expect(mockToastNotify).not.toHaveBeenCalled()
    expect(mockUpdateModelProviders).not.toHaveBeenCalled()
    expect(mockUpdateModelList).not.toHaveBeenCalled()
    await user.click(apiKey)
    await waitFor(() => expect(mockUpdateModelProviders).toHaveBeenCalledTimes(1))
    expect(mockChangePriorityFn).toHaveBeenCalledTimes(2)
  })
})

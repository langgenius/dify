import type { ModelProvider } from '../../declarations'
import { zProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  createProviderSummaryFixture,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import CredentialPanel from '../credential-panel'

const { mockToastNotify, mockTrialCredits, getProviders, getModels, mockChangePriorityFn } =
  vi.hoisted(() => ({
    mockToastNotify: vi.fn(),
    getProviders: vi.fn(),
    getModels: vi.fn(),
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
      'workspaces.current.modelProviders.summary.get': getProviders,
      'workspaces.current.models.modelTypes.byModelType.get': getModels,
      'workspaces.current.modelProviders.byProvider.preferredProviderType.post': (input) =>
        mockChangePriorityFn(input),
    }),
  }
})

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

const providerName = 'langgenius/openai/openai'
const providerCatalog = (priority: 'system' | 'custom') => ({
  data: [
    createProviderSummaryFixture({ provider: providerName, preferred_provider_type: priority }),
  ],
  plugins: {},
})
const modelCatalog = (name: string) => ({
  data: [
    createModelCatalogFixture({
      provider: providerName,
      models: [createCatalogModelFixture({ model: name, label: { en_US: name } })],
    }),
  ],
})
const modelQueryOptions = () =>
  consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
    input: { params: { model_type: 'llm' } },
  })
function CatalogConsumer() {
  const { data: providers } = useQuery(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions(),
  )
  const { data: models } = useQuery(modelQueryOptions())
  return (
    <>
      <output aria-label="Provider priority">
        {providers?.data.find((item) => item.provider === providerName)?.preferred_provider_type}
      </output>
      <output aria-label="Available models">
        {models?.data
          .flatMap((provider) => provider.models.map((model) => model.label.en_US))
          .join(', ')}
      </output>
    </>
  )
}
const renderWithQueryClient = (provider: ModelProvider, observeCatalog = false) => {
  const queryClient = createConsoleQueryClient()
  if (observeCatalog) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
      providerCatalog('system'),
    )
    queryClient.setQueryData(modelQueryOptions().queryKey, {
      data: modelCatalog('Trial model').data.map((item) => zProviderWithModelsResponse.parse(item)),
    })
  }
  return renderWithConsoleQuery(
    <>
      <CredentialPanel provider={provider} />
      {observeCatalog && <CatalogConsumer />}
    </>,
    {
      queryClient,
      systemFeatures: { deployment_edition: 'CLOUD' },
      trialModels: [providerName],
      workspacePermissionKeys: ['credential.use'],
    },
  )
}

describe('CredentialPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviders.mockResolvedValue(providerCatalog('custom'))
    getModels.mockResolvedValue(modelCatalog('API key model'))
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
    renderWithQueryClient(createProvider(), true)
    await user.click(screen.getByRole('button', { name: 'common.operation.config' }))
    const apiKey = screen.getByRole('button', { name: /apiKeyOption/ })
    await user.click(apiKey)
    expect(mockChangePriorityFn).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'langgenius/openai/openai' },
      body: { preferred_provider_type: 'custom' },
    })
    expect(apiKey).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Provider priority' })).toHaveTextContent('system')
    expect(screen.getByRole('status', { name: 'Available models' })).toHaveTextContent(
      'Trial model',
    )
    await act(async () => request.resolve({ result: 'success' }))
    await waitFor(() => expect(apiKey).toBeEnabled())
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Provider priority' })).toHaveTextContent('custom'),
    )
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Available models' })).toHaveTextContent(
        'API key model',
      ),
    )
  })

  it('reports a failed priority change without refreshing and allows retry', async () => {
    const user = userEvent.setup()
    mockChangePriorityFn.mockRejectedValueOnce(new Error('Unavailable'))
    renderWithQueryClient(createProvider(), true)
    await user.click(screen.getByRole('button', { name: 'common.operation.config' }))
    const apiKey = screen.getByRole('button', { name: /apiKeyOption/ })
    await user.click(apiKey)
    await waitFor(() =>
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      }),
    )
    expect(apiKey).toBeEnabled()
    expect(screen.getByRole('status', { name: 'Provider priority' })).toHaveTextContent('system')
    expect(screen.getByRole('status', { name: 'Available models' })).toHaveTextContent(
      'Trial model',
    )
    await user.click(apiKey)
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Provider priority' })).toHaveTextContent('custom'),
    )
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Available models' })).toHaveTextContent(
        'API key model',
      ),
    )
    expect(mockChangePriorityFn).toHaveBeenCalledTimes(2)
  })
})

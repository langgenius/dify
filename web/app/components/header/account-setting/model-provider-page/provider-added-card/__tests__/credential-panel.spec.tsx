import type { ModelProvider } from '../../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  mockTrialCredits: { credits: 100, totalCredits: 10_000, isExhausted: false, isLoading: false, nextCreditResetDate: undefined },
  mockChangePriorityFn: vi.fn().mockResolvedValue({ result: 'success' }),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, IS_CLOUD_EDITION: true }
})

vi.mock('@/context/global-public-context', () => ({
  useSystemFeaturesQuery: () => ({ data: { trial_models: ['langgenius/openai/openai'] } }),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: mockToastNotify },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    modelProviders: {
      models: {
        queryKey: ({ input }: { input: { params: { provider: string } } }) => ['console', 'modelProviders', 'models', input.params.provider],
      },
      changePreferredProviderType: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: (...args: unknown[]) => {
            mockChangePriorityFn(...args)
            return Promise.resolve({ result: 'success' })
          },
          ...opts,
        }),
      },
    },
  },
}))

vi.mock('../../hooks', () => ({
  useUpdateModelList: () => mockUpdateModelList,
  useUpdateModelProviders: () => mockUpdateModelProviders,
}))

vi.mock('../use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

vi.mock('../model-auth-dropdown', () => ({
  default: ({ state, onChangePriority }: { state: { variant: string, hasCredentials: boolean }, onChangePriority: (key: string) => void }) => (
    <div data-testid="model-auth-dropdown" data-variant={state.variant}>
      <button data-testid="change-priority-btn" onClick={() => onChangePriority('custom')}>
        Change Priority
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div data-testid="indicator" data-color={color} />,
}))

vi.mock('@/app/components/base/icons/src/vender/line/alertsAndFeedback/Warning', () => ({
  default: (props: Record<string, unknown>) => <div data-testid="warning-icon" className={props.className as string} />,
}))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
})

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
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
} as unknown as ModelProvider)

const renderWithQueryClient = (provider: ModelProvider) => {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <CredentialPanel provider={provider} />
    </QueryClientProvider>,
  )
}

describe('CredentialPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mockTrialCredits, { credits: 100, totalCredits: 10_000, isExhausted: false, isLoading: false })
  })

  describe('Text label variants', () => {
    it('should show "AI credits in use" for credits-active variant', () => {
      renderWithQueryClient(createProvider())
      expect(screen.getByText(/aiCreditsInUse/)).toBeInTheDocument()
    })

    it('should show "Credits exhausted" for credits-exhausted variant (no credentials)', () => {
      mockTrialCredits.isExhausted = true
      mockTrialCredits.credits = 0
      renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(screen.getByText(/quotaExhausted/)).toBeInTheDocument()
    })

    it('should show "No available usage" for no-usage variant (exhausted + credential unauthorized)', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1' }],
        },
      }))
      expect(screen.getByText(/noAvailableUsage/)).toBeInTheDocument()
    })

    it('should show "AI credits in use" with warning for credits-fallback (custom priority, no credentials, credits available)', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(screen.getByText(/aiCreditsInUse/)).toBeInTheDocument()
    })

    it('should show "AI credits in use" with warning for credits-fallback (custom priority, credential unauthorized, credits available)', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1' }],
        },
      }))
      expect(screen.getByText(/aiCreditsInUse/)).toBeInTheDocument()
    })

    it('should show warning icon for credits-fallback variant', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(screen.getByTestId('warning-icon')).toBeInTheDocument()
    })
  })

  describe('Status label variants', () => {
    it('should show green indicator and credential name for api-fallback (exhausted + authorized key)', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider())
      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'green')
      expect(screen.getByText('test-credential')).toBeInTheDocument()
    })

    it('should show warning icon for api-fallback variant', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider())
      expect(screen.getByTestId('warning-icon')).toBeInTheDocument()
    })

    it('should show green indicator for api-active (custom priority + authorized)', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
      }))
      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'green')
      expect(screen.getByText('test-credential')).toBeInTheDocument()
    })

    it('should NOT show warning icon for api-active variant', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
      }))
      expect(screen.queryByTestId('warning-icon')).not.toBeInTheDocument()
    })

    it('should show red indicator and credential name for api-unavailable (exhausted + named unauthorized key)', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: 'Bad Key',
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'Bad Key' }],
        },
      }))
      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'red')
      expect(screen.getByText('Bad Key')).toBeInTheDocument()
    })
  })

  describe('Destructive styling', () => {
    it('should apply destructive container for credits-exhausted', () => {
      mockTrialCredits.isExhausted = true
      const { container } = renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(container.querySelector('[class*="border-state-destructive"]')).toBeTruthy()
    })

    it('should apply destructive container for no-usage variant', () => {
      mockTrialCredits.isExhausted = true
      const { container } = renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1' }],
        },
      }))
      expect(container.querySelector('[class*="border-state-destructive"]')).toBeTruthy()
    })

    it('should apply destructive container for api-unavailable variant', () => {
      mockTrialCredits.isExhausted = true
      const { container } = renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: 'Bad Key',
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'Bad Key' }],
        },
      }))
      expect(container.querySelector('[class*="border-state-destructive"]')).toBeTruthy()
    })

    it('should apply default container for credits-active', () => {
      const { container } = renderWithQueryClient(createProvider())
      expect(container.querySelector('[class*="bg-white"]')).toBeTruthy()
    })

    it('should apply default container for api-active', () => {
      const { container } = renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
      }))
      expect(container.querySelector('[class*="bg-white"]')).toBeTruthy()
    })

    it('should apply default container for api-fallback', () => {
      mockTrialCredits.isExhausted = true
      const { container } = renderWithQueryClient(createProvider())
      expect(container.querySelector('[class*="bg-white"]')).toBeTruthy()
    })
  })

  describe('Text color', () => {
    it('should use destructive text color for credits-exhausted label', () => {
      mockTrialCredits.isExhausted = true
      const { container } = renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(container.querySelector('.text-text-destructive')).toBeTruthy()
    })

    it('should use secondary text color for credits-active label', () => {
      const { container } = renderWithQueryClient(createProvider())
      expect(container.querySelector('.text-text-secondary')).toBeTruthy()
    })

    it('should use destructive text color for api-unavailable credential name', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: 'Bad Key',
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'Bad Key' }],
        },
      }))
      expect(screen.getByText('Bad Key')).toHaveClass('text-text-destructive')
    })

    it('should use secondary text color for api-active credential name', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
      }))
      expect(screen.getByText('test-credential')).toHaveClass('text-text-secondary')
    })
  })

  describe('Priority change', () => {
    it('should call mutation with correct params on priority change', async () => {
      renderWithQueryClient(createProvider())

      await act(async () => {
        fireEvent.click(screen.getByTestId('change-priority-btn'))
      })

      await waitFor(() => {
        expect(mockChangePriorityFn.mock.calls[0]?.[0]).toEqual({
          params: { provider: 'langgenius/openai/openai' },
          body: { preferred_provider_type: 'custom' },
        })
      })
    })

    it('should show success toast and refresh data after successful mutation', async () => {
      renderWithQueryClient(createProvider())

      await act(async () => {
        fireEvent.click(screen.getByTestId('change-priority-btn'))
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'success' }),
        )
        expect(mockUpdateModelProviders).toHaveBeenCalled()
        expect(mockUpdateModelList).toHaveBeenCalledWith('llm')
      })
    })
  })

  describe('ModelAuthDropdown integration', () => {
    it('should pass credits-active variant to dropdown when credits available', () => {
      renderWithQueryClient(createProvider())
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'credits-active')
    })

    it('should pass api-fallback variant to dropdown when exhausted with valid key', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider())
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'api-fallback')
    })

    it('should pass credits-exhausted variant when exhausted with no credentials', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'credits-exhausted')
    })

    it('should pass api-active variant for custom priority with authorized key', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
      }))
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'api-active')
    })

    it('should pass credits-fallback variant for custom priority with no credentials and credits available', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'credits-fallback')
    })

    it('should pass credits-fallback variant for custom priority with named unauthorized key and credits available', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: 'Bad Key',
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'Bad Key' }],
        },
      }))
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'credits-fallback')
    })

    it('should pass no-usage variant when exhausted + credential but unauthorized', () => {
      mockTrialCredits.isExhausted = true
      renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1' }],
        },
      }))
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'no-usage')
    })
  })

  describe('apiKeyOnly priority (system disabled)', () => {
    it('should derive api-required-add when system config disabled and no credentials', () => {
      renderWithQueryClient(createProvider({
        system_configuration: { enabled: false, current_quota_type: CurrentSystemQuotaTypeEnum.trial, quota_configurations: [] },
        preferred_provider_type: PreferredProviderTypeEnum.system,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'api-required-add')
      expect(screen.getByText(/apiKeyRequired/)).toBeInTheDocument()
    })

    it('should derive api-active when system config disabled but has authorized key', () => {
      renderWithQueryClient(createProvider({
        system_configuration: { enabled: false, current_quota_type: CurrentSystemQuotaTypeEnum.trial, quota_configurations: [] },
      }))
      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'api-active')
    })
  })
})

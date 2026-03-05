import type { ModelProvider } from '../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { changeModelProviderPriority } from '@/service/common'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  PreferredProviderTypeEnum,
} from '../declarations'
import CredentialPanel from './credential-panel'

const mockEventEmitter = { emit: vi.fn() }
const mockNotify = vi.fn()
const mockUpdateModelList = vi.fn()
const mockUpdateModelProviders = vi.fn()
const mockTrialCredits = { credits: 100, isExhausted: false, isLoading: false, nextCreditResetDate: undefined }

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, IS_CLOUD_EDITION: true }
})

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: mockEventEmitter }),
}))

vi.mock('@/service/common', () => ({
  changeModelProviderPriority: vi.fn(),
}))

vi.mock('../hooks', () => ({
  useUpdateModelList: () => mockUpdateModelList,
  useUpdateModelProviders: () => mockUpdateModelProviders,
}))

vi.mock('./use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

vi.mock('./model-auth-dropdown', () => ({
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

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
  },
})

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'test-provider',
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
    Object.assign(mockTrialCredits, { credits: 100, isExhausted: false, isLoading: false })
  })

  // Text label variants
  describe('Text label variants', () => {
    it('should show "AI credits in use" for credits-active variant', () => {
      renderWithQueryClient(createProvider())

      expect(screen.getByText(/aiCreditsInUse/)).toBeInTheDocument()
    })

    it('should show "Credits exhausted" for credits-exhausted variant', () => {
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

    it('should show "No available usage" for no-usage variant', () => {
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

    it('should show "API key required" for api-required-add variant', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))

      expect(screen.getByText(/apiKeyRequired/)).toBeInTheDocument()
    })
  })

  // Status label variants (dot + credential name)
  describe('Status label variants', () => {
    it('should show green indicator and credential name for api-fallback', () => {
      mockTrialCredits.isExhausted = true

      renderWithQueryClient(createProvider())

      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'green')
      expect(screen.getByText('test-credential')).toBeInTheDocument()
    })

    it('should show green indicator for api-active', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
      }))

      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'green')
    })

    it('should show red indicator and "Unavailable" for api-unavailable', () => {
      renderWithQueryClient(createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1' }],
        },
      }))

      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'red')
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    })
  })

  // Destructive styling
  describe('Destructive styling', () => {
    it('should apply destructive container for credits-exhausted', () => {
      mockTrialCredits.isExhausted = true

      const { container } = renderWithQueryClient(createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      }))

      const card = container.querySelector('[class*="border-state-destructive"]')
      expect(card).toBeTruthy()
    })

    it('should apply default container for credits-active', () => {
      const { container } = renderWithQueryClient(createProvider())

      const card = container.querySelector('[class*="bg-white"]')
      expect(card).toBeTruthy()
    })
  })

  // Priority change
  describe('Priority change', () => {
    it('should change priority and refresh data after success', async () => {
      const mockChangePriority = changeModelProviderPriority as ReturnType<typeof vi.fn>
      mockChangePriority.mockResolvedValue({ result: 'success' })

      renderWithQueryClient(createProvider())

      fireEvent.click(screen.getByTestId('change-priority-btn'))

      await waitFor(() => {
        expect(mockChangePriority).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalled()
        expect(mockUpdateModelProviders).toHaveBeenCalled()
        expect(mockUpdateModelList).toHaveBeenCalledWith('llm')
        expect(mockEventEmitter.emit).toHaveBeenCalled()
      })
    })
  })

  // ModelAuthDropdown integration
  describe('ModelAuthDropdown integration', () => {
    it('should pass state variant to ModelAuthDropdown', () => {
      renderWithQueryClient(createProvider())

      expect(screen.getByTestId('model-auth-dropdown')).toHaveAttribute('data-variant', 'credits-active')
    })
  })
})

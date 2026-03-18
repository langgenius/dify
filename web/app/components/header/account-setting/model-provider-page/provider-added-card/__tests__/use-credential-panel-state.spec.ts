import type { ModelProvider } from '../../declarations'
import { renderHook } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import { isDestructiveVariant, useCredentialPanelState } from '../use-credential-panel-state'

const mockTrialCredits = { credits: 100, totalCredits: 10_000, isExhausted: false, isLoading: false, nextCreditResetDate: undefined }
const mockTrialModels = ['langgenius/openai/openai', 'langgenius/anthropic/anthropic']

vi.mock('../use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

vi.mock('@/context/global-public-context', () => ({
  useSystemFeaturesQuery: () => ({ data: { trial_models: mockTrialModels } }),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, IS_CLOUD_EDITION: true }
})

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'langgenius/openai/openai',
  provider_credential_schema: { credential_form_schemas: [] },
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    current_credential_id: 'cred-1',
    current_credential_name: 'My Key',
    available_credentials: [{ credential_id: 'cred-1', credential_name: 'My Key' }],
  },
  system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  configurate_methods: [ConfigurationMethodEnum.predefinedModel],
  supported_model_types: ['llm'],
  ...overrides,
} as unknown as ModelProvider)

describe('useCredentialPanelState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mockTrialCredits, { credits: 100, totalCredits: 10_000, isExhausted: false, isLoading: false })
  })

  // Credits priority variants
  describe('Credits priority variants', () => {
    it('should return credits-active when credits available', () => {
      const { result } = renderHook(() => useCredentialPanelState(createProvider()))

      expect(result.current.variant).toBe('credits-active')
      expect(result.current.priority).toBe('credits')
      expect(result.current.supportsCredits).toBe(true)
    })

    it('should return api-fallback when credits exhausted but API key authorized', () => {
      mockTrialCredits.isExhausted = true
      mockTrialCredits.credits = 0

      const { result } = renderHook(() => useCredentialPanelState(createProvider()))

      expect(result.current.variant).toBe('api-fallback')
    })

    it('should return no-usage when credits exhausted and API key unauthorized', () => {
      mockTrialCredits.isExhausted = true
      const provider = createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'My Key' }],
        },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('no-usage')
    })

    it('should return credits-exhausted when credits exhausted and no credentials', () => {
      mockTrialCredits.isExhausted = true
      const provider = createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('credits-exhausted')
    })
  })

  // API key priority variants
  describe('API key priority variants', () => {
    it('should return api-active when API key authorized', () => {
      const provider = createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('api-active')
      expect(result.current.priority).toBe('apiKey')
    })

    it('should return credits-fallback when API key unauthorized and credits available', () => {
      const provider = createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'My Key' }],
        },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('credits-fallback')
    })

    it('should return credits-fallback when no credentials and credits available', () => {
      const provider = createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('credits-fallback')
    })

    it('should return no-usage when no credentials and credits exhausted', () => {
      mockTrialCredits.isExhausted = true
      mockTrialCredits.credits = 0
      const provider = createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          available_credentials: [],
        },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('no-usage')
    })

    it('should return api-unavailable when credential with name unauthorized and credits exhausted', () => {
      mockTrialCredits.isExhausted = true
      mockTrialCredits.credits = 0
      const provider = createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: undefined,
          current_credential_name: 'Bad Key',
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'Bad Key' }],
        },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('api-unavailable')
    })

    it('should return api-required-configure when credentials exist but the current credential is incomplete', () => {
      mockTrialCredits.isExhausted = true
      mockTrialCredits.credits = 0
      const provider = createProvider({
        preferred_provider_type: PreferredProviderTypeEnum.custom,
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          current_credential_id: 'cred-1',
          current_credential_name: undefined,
          available_credentials: [{ credential_id: 'cred-1', credential_name: 'Bad Key' }],
        },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.variant).toBe('api-required-configure')
    })
  })

  // apiKeyOnly priority
  describe('apiKeyOnly priority (non-cloud / system disabled / not in trial_models)', () => {
    it('should return apiKeyOnly when system config disabled', () => {
      const provider = createProvider({
        system_configuration: { enabled: false, current_quota_type: CurrentSystemQuotaTypeEnum.trial, quota_configurations: [] },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.priority).toBe('apiKeyOnly')
      expect(result.current.supportsCredits).toBe(false)
    })

    it('should return apiKeyOnly when provider not in trial_models even if system enabled', () => {
      const provider = createProvider({
        provider: 'langgenius/minimax/minimax',
        system_configuration: { enabled: true, current_quota_type: CurrentSystemQuotaTypeEnum.trial, quota_configurations: [] },
        preferred_provider_type: PreferredProviderTypeEnum.system,
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.priority).toBe('apiKeyOnly')
      expect(result.current.supportsCredits).toBe(false)
      expect(result.current.showPrioritySwitcher).toBe(false)
    })
  })

  // Undefined provider
  describe('Undefined provider', () => {
    it('should return safe defaults when provider is undefined', () => {
      const { result } = renderHook(() => useCredentialPanelState(undefined))

      expect(result.current.priority).toBe('apiKeyOnly')
      expect(result.current.supportsCredits).toBe(false)
      expect(result.current.hasCredentials).toBe(false)
      expect(result.current.credentialName).toBeUndefined()
    })
  })

  // Derived metadata
  describe('Derived metadata', () => {
    it('should show priority switcher when credits supported and custom config active', () => {
      const provider = createProvider()

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.showPrioritySwitcher).toBe(true)
    })

    it('should hide priority switcher when system config disabled', () => {
      const provider = createProvider({
        system_configuration: { enabled: false, current_quota_type: CurrentSystemQuotaTypeEnum.trial, quota_configurations: [] },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.showPrioritySwitcher).toBe(false)
    })

    it('should hide priority switcher when provider not in trial_models', () => {
      const provider = createProvider({
        provider: 'langgenius/zhipuai/zhipuai',
        system_configuration: { enabled: true, current_quota_type: CurrentSystemQuotaTypeEnum.trial, quota_configurations: [] },
      })

      const { result } = renderHook(() => useCredentialPanelState(provider))

      expect(result.current.showPrioritySwitcher).toBe(false)
    })

    it('should expose credential name from provider', () => {
      const { result } = renderHook(() => useCredentialPanelState(createProvider()))

      expect(result.current.credentialName).toBe('My Key')
    })

    it('should expose credits amount', () => {
      mockTrialCredits.credits = 500

      const { result } = renderHook(() => useCredentialPanelState(createProvider()))

      expect(result.current.credits).toBe(500)
    })
  })
})

describe('isDestructiveVariant', () => {
  it.each([
    ['credits-exhausted', true],
    ['no-usage', true],
    ['api-unavailable', true],
    ['credits-active', false],
    ['api-fallback', false],
    ['api-active', false],
    ['api-required-add', false],
    ['api-required-configure', false],
  ] as const)('should return %s for variant %s', (variant, expected) => {
    expect(isDestructiveVariant(variant)).toBe(expected)
  })
})

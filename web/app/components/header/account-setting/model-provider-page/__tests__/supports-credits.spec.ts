import type { ModelProvider } from '../declarations'
import { CurrentSystemQuotaTypeEnum } from '../declarations'
import { providerSupportsCredits } from '../supports-credits'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, IS_CLOUD_EDITION: true }
})

const makeProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'langgenius/openai/openai',
  system_configuration: {
    enabled: true,
    current_quota_type: CurrentSystemQuotaTypeEnum.trial,
    quota_configurations: [],
  },
  ...overrides,
} as ModelProvider)

describe('providerSupportsCredits', () => {
  it('returns true when the provider is system-enabled and listed in trial_models', () => {
    expect(providerSupportsCredits(makeProvider(), ['langgenius/openai/openai'])).toBe(true)
  })

  it('returns false when the provider is not listed in trial_models', () => {
    expect(providerSupportsCredits(makeProvider(), ['langgenius/anthropic/anthropic'])).toBe(false)
  })

  it('returns false when system hosting is disabled', () => {
    expect(providerSupportsCredits(makeProvider({
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.trial,
        quota_configurations: [],
      },
    }), ['langgenius/openai/openai'])).toBe(false)
  })

  it('returns false for an undefined provider', () => {
    expect(providerSupportsCredits(undefined, ['langgenius/openai/openai'])).toBe(false)
  })
})

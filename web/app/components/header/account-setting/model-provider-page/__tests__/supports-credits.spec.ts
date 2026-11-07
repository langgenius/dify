import { providerSupportsCredits } from '../supports-credits'

type CreditAwareProvider = NonNullable<Parameters<typeof providerSupportsCredits>[0]>

const makeProvider = (overrides: Partial<CreditAwareProvider> = {}): CreditAwareProvider => ({
  provider: 'langgenius/openai/openai',
  system_configuration: {
    enabled: true,
  },
  ...overrides,
})

describe('providerSupportsCredits', () => {
  it('returns true when the provider is system-enabled and listed in trial_models', () => {
    expect(providerSupportsCredits(makeProvider(), ['langgenius/openai/openai'], 'CLOUD')).toBe(
      true,
    )
  })

  it('returns false when the provider is not listed in trial_models', () => {
    expect(
      providerSupportsCredits(makeProvider(), ['langgenius/anthropic/anthropic'], 'CLOUD'),
    ).toBe(false)
  })

  it('returns false when system hosting is disabled', () => {
    expect(
      providerSupportsCredits(
        makeProvider({
          system_configuration: {
            enabled: false,
          },
        }),
        ['langgenius/openai/openai'],
        'CLOUD',
      ),
    ).toBe(false)
  })

  it('returns false for an undefined provider', () => {
    expect(providerSupportsCredits(undefined, ['langgenius/openai/openai'], 'CLOUD')).toBe(false)
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'returns false outside Cloud when deployment edition is %s',
    (deploymentEdition) => {
      expect(
        providerSupportsCredits(makeProvider(), ['langgenius/openai/openai'], deploymentEdition),
      ).toBe(false)
    },
  )
})

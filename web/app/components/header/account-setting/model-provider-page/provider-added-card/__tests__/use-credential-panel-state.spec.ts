import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { createProviderMeta } from '@/app/components/workflow/__tests__/model-provider-fixtures'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { isDestructiveVariant, useCredentialPanelState } from '../use-credential-panel-state'

type Provider = ReturnType<typeof createProviderMeta>
const credential = { credential_id: 'cred-1', credential_name: 'My Key' }
const configurations = {
  authorized: {
    status: 'active',
    current_credential_id: 'cred-1',
    current_credential_name: 'My Key',
    available_credentials: [credential],
  },
  unselected: { status: 'active', available_credentials: [credential] },
  unavailable: {
    status: 'active',
    current_credential_id: 'cred-1',
    current_credential_name: 'Bad Key',
    available_credentials: [{ ...credential, not_allowed_to_use: true }],
  },
  removed: {
    status: 'active',
    current_credential_name: 'Bad Key',
    available_credentials: [credential],
  },
  incomplete: {
    status: 'active',
    current_credential_id: 'cred-1',
    available_credentials: [credential],
  },
  empty: { status: 'no-configure', available_credentials: [] },
} satisfies Record<string, Provider['custom_configuration']>

const createProvider = (overrides: Partial<Provider> = {}) =>
  createProviderMeta({
    provider: 'langgenius/openai/openai',
    custom_configuration: configurations.authorized,
    system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
    preferred_provider_type: 'system',
    ...overrides,
  })

const renderPanelHook = (
  provider: Provider | undefined,
  exhausted = false,
  edition: DeploymentEdition = 'CLOUD',
) => {
  const queryClient = createConsoleQueryClient()
  const credits: ModelProviderCreditsResponse = {
    pool_type: 'trial',
    quota_limit: 100,
    quota_used: exhausted ? 100 : 40,
    remaining_credits: exhausted ? 0 : 60,
    is_unlimited: false,
    is_exhausted: exhausted,
    exhausted_at: null,
    next_credit_reset_date: null,
  }
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
    credits,
  )
  return renderHookWithConsoleQuery(() => useCredentialPanelState(provider), {
    queryClient,
    systemFeatures: { deployment_edition: edition },
    trialModels: ['langgenius/openai/openai'],
  })
}

describe('useCredentialPanelState', () => {
  it.each([
    ['system', 'authorized', false, 'credits-active'],
    ['system', 'authorized', true, 'api-fallback'],
    ['system', 'unselected', true, 'no-usage'],
    ['system', 'unavailable', true, 'no-usage'],
    ['system', 'empty', true, 'credits-exhausted'],
    ['custom', 'authorized', false, 'api-active'],
    ['custom', 'unselected', false, 'credits-fallback'],
    ['custom', 'empty', false, 'credits-fallback'],
    ['custom', 'empty', true, 'no-usage'],
    ['custom', 'removed', true, 'api-unavailable'],
    ['custom', 'unavailable', true, 'api-unavailable'],
    ['custom', 'incomplete', true, 'api-required-configure'],
  ] as const)(
    'uses %s priority with %s credentials and exhausted=%s to show %s',
    (preferred, configuration, exhausted, variant) => {
      const { result } = renderPanelHook(
        createProvider({
          preferred_provider_type: preferred,
          custom_configuration: configurations[configuration],
        }),
        exhausted,
      )
      expect(result.current).toMatchObject({
        variant,
        priority: preferred === 'system' ? 'credits' : 'apiKey',
        supportsCredits: true,
        showPrioritySwitcher: true,
        isCreditsExhausted: exhausted,
        credits: exhausted ? 0 : 60,
      })
    },
  )

  it.each([
    {
      reason: 'system provider disabled',
      provider: createProvider({
        system_configuration: { enabled: false, quota_configurations: [] },
      }),
      edition: 'CLOUD',
    },
    {
      reason: 'provider outside trial list',
      provider: createProvider({ provider: 'langgenius/minimax/minimax' }),
      edition: 'CLOUD',
    },
    { reason: 'community deployment', provider: createProvider(), edition: 'COMMUNITY' },
  ] as const)('uses only API credentials when $reason', ({ provider, edition }) => {
    const { result } = renderPanelHook(provider, false, edition)
    expect(result.current).toMatchObject({
      priority: 'apiKeyOnly',
      supportsCredits: false,
      showPrioritySwitcher: false,
      variant: 'api-active',
      credentialName: 'My Key',
      hasCredentials: true,
    })
  })

  it('requests credentials while the provider is unavailable', () => {
    const { result } = renderPanelHook(undefined)
    expect(result.current).toMatchObject({
      priority: 'apiKeyOnly',
      supportsCredits: false,
      hasCredentials: false,
      credentialName: undefined,
      variant: 'api-required-add',
    })
  })
})

describe('isDestructiveVariant', () => {
  it.each([
    ['credits-exhausted', true],
    ['no-usage', true],
    ['api-unavailable', true],
    ['credits-active', false],
    ['credits-fallback', false],
    ['api-fallback', false],
    ['api-active', false],
    ['api-required-add', false],
    ['api-required-configure', false],
  ] as const)('classifies %s as destructive=%s', (variant, expected) => {
    expect(isDestructiveVariant(variant)).toBe(expected)
  })
})

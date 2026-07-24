import type { ModelProvider } from '../declarations'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useCredentialStatus } from '@/app/components/header/account-setting/model-provider-page/model-auth/hooks'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'
import { PreferredProviderTypeEnum } from '../declarations'
import { providerSupportsCredits } from '../supports-credits'
import { useTrialCredits } from './use-trial-credits'

export type UsagePriority = 'credits' | 'apiKey' | 'apiKeyOnly'

export type CardVariant =
  | 'credits-active'
  | 'credits-fallback'
  | 'credits-exhausted'
  | 'no-usage'
  | 'api-fallback'
  | 'api-active'
  | 'api-required-add'
  | 'api-required-configure'
  | 'api-unavailable'

export type CredentialPanelState = {
  variant: CardVariant
  priority: UsagePriority
  supportsCredits: boolean
  showPrioritySwitcher: boolean
  hasCredentials: boolean
  isCreditsExhausted: boolean
  credentialName: string | undefined
  credits: number
}

const DESTRUCTIVE_VARIANTS = new Set<CardVariant>([
  'credits-exhausted',
  'no-usage',
  'api-unavailable',
])

export const isDestructiveVariant = (variant: CardVariant) => DESTRUCTIVE_VARIANTS.has(variant)

function deriveVariant(
  priority: UsagePriority,
  isExhausted: boolean,
  hasCredential: boolean,
  authorized: boolean | undefined,
  credentialName: string | undefined,
): CardVariant {
  if (priority === 'credits') {
    if (!isExhausted) return 'credits-active'
    if (hasCredential && authorized) return 'api-fallback'
    if (hasCredential && !authorized) return 'no-usage'
    return 'credits-exhausted'
  }

  if (hasCredential && authorized) return 'api-active'

  if (priority === 'apiKey' && !isExhausted) return 'credits-fallback'

  if (priority === 'apiKey' && !hasCredential) return 'no-usage'

  if (hasCredential && !authorized)
    return credentialName ? 'api-unavailable' : 'api-required-configure'
  return 'api-required-add'
}

export function useCredentialPanelState(provider: ModelProvider | undefined): CredentialPanelState {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { isExhausted, credits } = useTrialCredits()
  const { hasCredential, authorized, current_credential_name } = useCredentialStatus(provider)

  const { data: trialModels = [] } = useQuery(
    consoleQuery.trialModels.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.trial_models,
    }),
  )

  const preferredType = provider?.preferred_provider_type

  const supportsCredits = providerSupportsCredits(provider, trialModels, deploymentEdition)

  const priority: UsagePriority = !supportsCredits
    ? 'apiKeyOnly'
    : preferredType === PreferredProviderTypeEnum.system
      ? 'credits'
      : 'apiKey'

  const showPrioritySwitcher = supportsCredits

  const variant = deriveVariant(
    priority,
    isExhausted,
    hasCredential,
    !!authorized,
    current_credential_name,
  )

  return {
    variant,
    priority,
    supportsCredits,
    showPrioritySwitcher,
    hasCredentials: hasCredential,
    isCreditsExhausted: isExhausted,
    credentialName: current_credential_name,
    credits,
  }
}

import type { ModelProvider } from './declarations'
import { IS_CLOUD_EDITION } from '@/config'

type CreditAwareProvider = Pick<ModelProvider, 'provider' | 'system_configuration'>

export const providerSupportsCredits = (
  provider: CreditAwareProvider | undefined,
  trialModels: readonly string[] | undefined,
): boolean => {
  if (!IS_CLOUD_EDITION || !provider?.system_configuration.enabled)
    return false

  return !!provider.provider && !!trialModels?.includes(provider.provider)
}

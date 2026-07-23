import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ModelProvider } from './declarations'

type CreditAwareProvider = Pick<ModelProvider, 'provider' | 'system_configuration'>

export const providerSupportsCredits = (
  provider: CreditAwareProvider | undefined,
  trialModels: readonly string[] | undefined,
  deploymentEdition: DeploymentEdition | null,
): boolean => {
  if (deploymentEdition !== 'CLOUD' || !provider?.system_configuration.enabled) return false

  return !!provider.provider && !!trialModels?.includes(provider.provider)
}

import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'

type CreditAwareProvider = Pick<ModelProviderSummaryResponse, 'provider' | 'system_configuration'>

export const providerSupportsCredits = (
  provider: CreditAwareProvider | undefined,
  trialModels: readonly string[] | undefined,
  deploymentEdition: DeploymentEdition,
): boolean => {
  if (deploymentEdition !== 'CLOUD' || !provider?.system_configuration.enabled) return false

  return !!provider.provider && !!trialModels?.includes(provider.provider)
}

import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

export const canAccessSnippetsAndEvaluation = ({
  deploymentEdition,
  planType,
}: {
  deploymentEdition: DeploymentEdition
  planType?: CloudPlan
}) => {
  if (deploymentEdition !== 'CLOUD') return true

  return planType === 'professional' || planType === 'team'
}

import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

export function isEducationPlanAvailable({
  deploymentEdition,
  enabled,
}: {
  deploymentEdition?: DeploymentEdition
  enabled?: boolean
}) {
  return deploymentEdition === 'CLOUD' && enabled === true
}

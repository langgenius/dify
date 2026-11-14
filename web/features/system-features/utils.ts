import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

export const isEvaluationEdition = (deploymentEdition: DeploymentEdition) =>
  deploymentEdition === 'ENTERPRISE' || deploymentEdition === 'CLOUD'

import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { isEvaluationEdition } from '@/features/system-features/utils'

export const canAccessSnippetsAndEvaluation = ({
  deploymentEdition,
  planType,
}: {
  deploymentEdition: DeploymentEdition
  planType?: CloudPlan
}) => {
  if (!isEvaluationEdition(deploymentEdition)) return false
  if (deploymentEdition === 'ENTERPRISE') return true

  return planType === 'professional' || planType === 'team'
}

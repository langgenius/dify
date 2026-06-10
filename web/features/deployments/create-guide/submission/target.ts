import type { DeploymentTargetSubmissionState } from '../queries/target'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'

export async function resolveSelectedDeploymentEnvironmentId(targetSubmissionState: DeploymentTargetSubmissionState) {
  if (targetSubmissionState.selectedEnvironment)
    return targetSubmissionState.selectedEnvironment.id

  const selectedEnvironmentIdentifier = targetSubmissionState.selectedEnvironmentId?.trim()
  if (!selectedEnvironmentIdentifier)
    return undefined

  const freshResult = await targetSubmissionState.deployableEnvironmentsQuery.refetch()
  const freshEnvironments = freshResult.data?.data ?? []
  const freshSelectedEnvironment = freshEnvironments.find(environment => environmentMatchesIdentifier(environment, selectedEnvironmentIdentifier))

  return freshSelectedEnvironment?.id
}

export function hasMissingDeploymentTargetBinding(targetSubmissionState: DeploymentTargetSubmissionState) {
  return targetSubmissionState.bindingSlots.some(slot =>
    hasMissingRequiredRuntimeCredentialBinding(slot, targetSubmissionState.bindingSelections[runtimeCredentialSlotKey(slot)]),
  )
}

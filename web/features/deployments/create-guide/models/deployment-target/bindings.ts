import type { CredentialSlot } from '@dify/contracts/enterprise/types.gen'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/components/runtime-credential-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/components/runtime-credential-bindings-utils'

export function createDeploymentTargetBindings({
  credentialSlots,
  manualBindingSelections,
  shouldLoadDeploymentTarget,
}: {
  credentialSlots: CredentialSlot[] | undefined
  manualBindingSelections: RuntimeCredentialBindingSelections
  shouldLoadDeploymentTarget: boolean
}) {
  const bindingSlots = shouldLoadDeploymentTarget
    ? credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
  const bindingSelections: RuntimeCredentialBindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
  const requiredBindingsReady = bindingSlots.every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]),
  )

  return {
    bindingSelections,
    bindingSlots,
    requiredBindingsReady,
  }
}

'use client'

import type { CredentialSlot } from '@dify/contracts/enterprise/types.gen'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/components/runtime-credential-bindings-utils'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import {
  manualBindingSelectionsAtom,
  selectBindingAtom,
} from '../../state/target-atoms'
import { createBindingSlots } from './option-slots'

export function useDeploymentTargetBindings({
  credentialSlots,
  shouldLoadDeploymentTarget,
}: {
  credentialSlots: CredentialSlot[] | undefined
  shouldLoadDeploymentTarget: boolean
}) {
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const selectBinding = useSetAtom(selectBindingAtom)
  const bindingSlots = createBindingSlots(shouldLoadDeploymentTarget, credentialSlots)
  const bindingSelections: RuntimeCredentialBindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
  const requiredBindingsReady = bindingSlots.every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]),
  )

  return {
    bindingSelections,
    bindingSlots,
    onSelectBinding: (slot: string, value: string) => selectBinding({ slot, value }),
    requiredBindingsReady,
  }
}

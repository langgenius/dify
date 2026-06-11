'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetBindings } from '../../../models/deployment-target/bindings'
import {
  useCreateGuideDeploymentOptionsQuery,
  useCreateGuideDeploymentTargetEnabled,
} from '../../../models/deployment-target/query-config'
import {
  manualBindingSelectionsAtom,
} from '../../../state/target-atoms'

export function useTargetBindingDeploymentOptionsQuery() {
  return useCreateGuideDeploymentOptionsQuery()
}

export function useTargetBindingSelections() {
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const shouldLoadDeploymentTarget = useCreateGuideDeploymentTargetEnabled()
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()

  return createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsQuery.data?.options?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget,
  }).bindingSelections
}

export function useTargetBindingSlots() {
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const shouldLoadDeploymentTarget = useCreateGuideDeploymentTargetEnabled()
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()

  return createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsQuery.data?.options?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget,
  }).bindingSlots
}

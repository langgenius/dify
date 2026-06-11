'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetBindings } from '../../../models/deployment-target/bindings'
import { useDeploymentTargetQueryGate } from '../../../models/deployment-target/query-gate'
import { useDeploymentOptionsQuery } from '../../../queries/target-options'
import {
  manualBindingSelectionsAtom,
} from '../../../state/target-atoms'
import { unsupportedDslNodesAtom } from '../../../state/unsupported-dsl-atoms'

function useDeploymentOptionsForTargetBinding() {
  const {
    encodedDslContent,
    effectiveSelectedApp,
    method,
    queryGate,
  } = useDeploymentTargetQueryGate()

  return useDeploymentOptionsQuery({
    encodedDslContent,
    effectiveSelectedApp,
    method,
    queryGate,
  })
}

export function useTargetBindingSelections() {
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const { queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsResult = useDeploymentOptionsForTargetBinding()

  return createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsResult.deploymentOptions?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  }).bindingSelections
}

export function useTargetBindingSlots() {
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const { queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsResult = useDeploymentOptionsForTargetBinding()

  return createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsResult.deploymentOptions?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  }).bindingSlots
}

export function useTargetBindingIsError() {
  return useDeploymentOptionsForTargetBinding().deploymentOptionsQuery.isError
}

export function useTargetBindingIsLoading() {
  const { queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsQuery = useDeploymentOptionsForTargetBinding().deploymentOptionsQuery

  return queryGate.shouldLoadDeploymentTarget
    && (deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
}

export function useShouldRenderTargetBindingSection() {
  const isBindingError = useTargetBindingIsError()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return !(isBindingError && unsupportedDslNodes.length > 0)
}

'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetEnvVars } from '../../../models/deployment-target/env-vars'
import {
  useCreateGuideDeploymentOptionsQuery,
  useCreateGuideDeploymentTargetEnabled,
} from '../../../models/deployment-target/query-config'
import { dslContentAtom } from '../../../state/dsl-atoms'
import {
  envVarValuesAtom,
} from '../../../state/target-atoms'
import { methodAtom } from '../../../state/workflow-atoms'

export function useTargetEnvVarDeploymentOptionsQuery() {
  return useCreateGuideDeploymentOptionsQuery()
}

export function useTargetEnvVarSlots() {
  const dslContent = useAtomValue(dslContentAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const method = useAtomValue(methodAtom)
  const shouldLoadDeploymentTarget = useCreateGuideDeploymentTargetEnabled()
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()

  return createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget,
    slots: deploymentOptionsQuery.data?.options?.envVarSlots,
  }).envVarSlots
}

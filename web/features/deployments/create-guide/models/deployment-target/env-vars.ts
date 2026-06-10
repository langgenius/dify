'use client'

import type { EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import type { GuideMethod } from '../../types'
import type { EnvVarValueSelection } from '@/features/deployments/components/env-var-bindings'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  envVarValuesAtom,
  setEnvVarAtom,
} from '../../state/target-atoms'
import {
  areRequiredEnvVarsReady,
} from '../selectors'
import {
  createTargetEnvVarSlots,
} from './option-slots'

export function useDeploymentTargetEnvVars({
  dslContent,
  method,
  shouldLoadDeploymentTarget,
  slots,
}: {
  dslContent: string
  method: GuideMethod
  shouldLoadDeploymentTarget: boolean
  slots: EnvVarSlot[] | undefined
}) {
  const envVarValues = useAtomValue(envVarValuesAtom)
  const setEnvVar = useSetAtom(setEnvVarAtom)
  const envVarSlots = createTargetEnvVarSlots({
    dslContent,
    method,
    shouldLoadDeploymentTarget,
    slots,
  })
  const requiredEnvVarsReady = areRequiredEnvVarsReady(envVarSlots, envVarValues)

  return {
    envVarSlots,
    envVarValues,
    onSetEnvVar: (key: string, value: EnvVarValueSelection) => setEnvVar({ key, value }),
    requiredEnvVarsReady,
  }
}

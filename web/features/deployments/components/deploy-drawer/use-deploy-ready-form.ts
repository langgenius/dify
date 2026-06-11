'use client'

import type {
  CredentialSelectionInput,
  CredentialSlot,
  Environment,
  EnvironmentDeployment,
  EnvVarInput,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { Getter } from 'jotai'
import type {
  EnvVarBindingSlot,
  EnvVarValues,
  EnvVarValueSelection,
} from '../env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '../runtime-credential-bindings-utils'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { createDeploymentIdempotencyKey } from '../../idempotency'
import { releaseDeploymentAction } from '../../release-action'
import { closeDeployDrawerAtom } from '../../store'
import { envVarBindingSlotFromContract } from '../env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '../runtime-credential-bindings-utils'

export type DeployReadyFormConfig = {
  appInstanceId: string
  environments: Environment[]
  releases: Release[]
  runtimeRows: EnvironmentDeployment[]
  defaultReleaseId?: string
  lockedEnvId?: string
  presetReleaseId?: string
  releaseEmptyLabel?: string
}

export const deployReadyFormConfigAtom = atom<DeployReadyFormConfig | undefined>(undefined)

const selectedEnvIdAtom = atom<string | undefined>(undefined)
const selectedReleaseIdAtom = atom<string | undefined>(undefined)
const manualBindingsAtom = atom<RuntimeCredentialBindingSelections>({})
const envVarValuesAtom = atom<EnvVarValues>({})
const showValidationErrorsAtom = atom(false)
export const deployReadyFormLocalAtoms = [
  selectedEnvIdAtom,
  selectedReleaseIdAtom,
  manualBindingsAtom,
  envVarValuesAtom,
  showValidationErrorsAtom,
] as const

function formConfig(get: Getter) {
  const config = get(deployReadyFormConfigAtom)
  if (!config)
    throw new Error('Missing deploy ready form config.')

  return config
}

const resetDeployBindingsAtom = atom(null, (_get, set) => {
  set(manualBindingsAtom, {})
  set(envVarValuesAtom, {})
  set(showValidationErrorsAtom, false)
})

const selectDeployEnvironmentAtom = atom(null, (_get, set, environmentId: string) => {
  set(selectedEnvIdAtom, environmentId)
  set(resetDeployBindingsAtom)
})

const selectDeployReleaseAtom = atom(null, (_get, set, releaseId: string) => {
  set(selectedReleaseIdAtom, releaseId)
  set(resetDeployBindingsAtom)
})

export const showDeployValidationErrorsAtom = atom(null, (_get, set) => {
  set(showValidationErrorsAtom, true)
})

const deployPresetReleaseAtom = atom((get) => {
  const config = formConfig(get)
  return config.presetReleaseId ? config.releases.find(r => r.id === config.presetReleaseId) : undefined
})

const deployDisplayedReleaseAtom = atom((get): Release | undefined => {
  return get(deployPresetReleaseAtom)
})

const deployIsExistingReleaseAtom = atom((get) => {
  const config = formConfig(get)
  return Boolean(config.presetReleaseId)
})

export const deploySelectedEnvironmentIdAtom = atom((get) => {
  const config = formConfig(get)
  return get(selectedEnvIdAtom) ?? config.lockedEnvId ?? config.environments[0]?.id
})

export const deploySelectedEnvironmentAtom = atom((get) => {
  const config = formConfig(get)
  const selectedEnvironmentId = get(deploySelectedEnvironmentIdAtom)
  return selectedEnvironmentId
    ? config.environments.find(env => env.id === selectedEnvironmentId)
    : undefined
})

const deploySelectedReleaseIdAtom = atom((get) => {
  const config = formConfig(get)
  const displayedRelease = get(deployDisplayedReleaseAtom)
  return get(selectedReleaseIdAtom) ?? displayedRelease?.id ?? config.defaultReleaseId
})

const deploySelectedReleaseAtom = atom((get) => {
  const config = formConfig(get)
  const selectedReleaseId = get(deploySelectedReleaseIdAtom)
  return selectedReleaseId
    ? config.releases.find(release => release.id === selectedReleaseId)
    : undefined
})

const deployTargetReleaseAtom = atom((get) => {
  return get(deployDisplayedReleaseAtom) ?? get(deploySelectedReleaseAtom)
})

export const deployTargetReleaseIdAtom = atom((get) => {
  const targetRelease = get(deployTargetReleaseAtom)
  return targetRelease?.id ?? get(deploySelectedReleaseIdAtom)
})

export const deployHasSelectedEnvironmentAtom = atom((get) => {
  return Boolean(get(deploySelectedEnvironmentAtom))
})

function useDeployReadyFormConfig() {
  const config = useAtomValue(deployReadyFormConfigAtom)
  if (!config)
    throw new Error('Missing deploy ready form config.')

  return config
}

export function useDeployReleaseField() {
  const config = useDeployReadyFormConfig()
  const displayedRelease = useAtomValue(deployDisplayedReleaseAtom)
  const isExistingRelease = useAtomValue(deployIsExistingReleaseAtom)
  const selectedReleaseId = useAtomValue(deploySelectedReleaseIdAtom)
  const selectRelease = useSetAtom(selectDeployReleaseAtom)

  return {
    displayedRelease,
    emptyLabel: config.releaseEmptyLabel,
    isExistingRelease,
    releases: config.releases,
    selectedReleaseId,
    selectRelease,
  }
}

export function useDeployEnvironmentField() {
  const config = useDeployReadyFormConfig()
  const selectedEnvironmentId = useAtomValue(deploySelectedEnvironmentIdAtom)
  const selectEnvironment = useSetAtom(selectDeployEnvironmentAtom)
  const lockedEnv = config.lockedEnvId ? config.environments.find(e => e.id === config.lockedEnvId) : undefined

  return {
    environments: config.environments,
    lockedEnv,
    lockedEnvId: config.lockedEnvId,
    selectedEnvironmentId,
    selectEnvironment,
  }
}

export function useReleaseDeploymentOptions() {
  const hasSelectedEnvironment = useAtomValue(deployHasSelectedEnvironmentAtom)
  const releaseId = useAtomValue(deployTargetReleaseIdAtom)
  const selectedEnvironmentId = useAtomValue(deploySelectedEnvironmentIdAtom)
  const shouldLoadDeploymentOptions = Boolean(releaseId && selectedEnvironmentId && hasSelectedEnvironment)
  const deploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.computeDeploymentOptions.queryOptions({
      input: shouldLoadDeploymentOptions && releaseId && selectedEnvironmentId
        ? {
            body: {
              releaseId,
              environmentId: selectedEnvironmentId,
            },
          }
        : skipToken,
    }),
    retry: false,
  })
  const bindingSlots = deploymentOptionsQuery.data?.options.credentialSlots.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
  const envVarSlots = deploymentOptionsQuery.data?.options.envVarSlots.flatMap((slot): EnvVarBindingSlot[] => {
    const bindingSlot = envVarBindingSlotFromContract(slot)
    return bindingSlot ? [bindingSlot] : []
  }) ?? []
  const deploymentOptionsLoading = deploymentOptionsQuery.isLoading || deploymentOptionsQuery.isFetching
  const isBindingOptionsLoading = Boolean(
    releaseId
    && hasSelectedEnvironment
    && deploymentOptionsLoading,
  )
  const hasBindingOptionsError = deploymentOptionsQuery.isError
  const isBindingOptionsReady = Boolean(
    releaseId
    && hasSelectedEnvironment
    && deploymentOptionsQuery.data
    && !isBindingOptionsLoading
    && !hasBindingOptionsError,
  )

  return {
    bindingSlots,
    envVarSlots,
    hasBindingOptionsError,
    isBindingOptionsLoading,
    isBindingOptionsReady,
  }
}

export function useDeployBindings({
  bindingSlots,
  envVarSlots,
}: {
  bindingSlots: CredentialSlot[]
  envVarSlots: EnvVarBindingSlot[]
}) {
  const [manualBindings, setManualBindings] = useAtom(manualBindingsAtom)
  const [envVarValues, setEnvVarValues] = useAtom(envVarValuesAtom)
  const showValidationErrors = useAtomValue(showValidationErrorsAtom)
  const showDeploymentValidationErrors = useSetAtom(showDeployValidationErrorsAtom)
  const selectedBindings = selectedRuntimeCredentialSelections(bindingSlots, manualBindings)
  const deploymentCredentials = selectedDeploymentRuntimeCredentials(bindingSlots, selectedBindings)
  const deploymentEnvVars = envVarSlots.flatMap((slot): EnvVarInput[] => {
    const selection = envVarValues[slot.key]
    const valueSource = selection?.valueSource
      ?? (slot.hasLastValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
        : slot.hasDefaultValue
          ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
          : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT) {
      return slot.hasLastValue
        ? [{ key: slot.key, valueSource }]
        : []
    }

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT) {
      return slot.hasDefaultValue
        ? [{ key: slot.key, valueSource }]
        : []
    }

    if (!selection?.value || (slot.valueType === 'number' && Number.isNaN(Number(selection.value))))
      return []

    return [{
      key: slot.key,
      value: selection.value,
      valueSource,
    }]
  })
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredRuntimeCredentialBinding(slot, selectedBindings[runtimeCredentialSlotKey(slot)]))
  const requiredEnvVarsReady = envVarSlots.every((slot) => {
    const selection = envVarValues[slot.key]
    const valueSource = selection?.valueSource
      ?? (slot.hasLastValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
        : slot.hasDefaultValue
          ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
          : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
      return Boolean(slot.hasLastValue)
    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
      return Boolean(slot.hasDefaultValue)
    if (!selection?.value)
      return false

    return slot.valueType !== 'number' || !Number.isNaN(Number(selection.value))
  })

  function handleBindingChange(slot: string, value: string) {
    setManualBindings(prev => ({ ...prev, [slot]: value }))
  }

  function handleEnvVarChange(key: string, value: EnvVarValueSelection) {
    setEnvVarValues(prev => ({ ...prev, [key]: value }))
  }

  return {
    deploymentCredentials,
    deploymentEnvVars,
    handleBindingChange,
    handleEnvVarChange,
    envVarValues,
    requiredBindingsReady,
    requiredEnvVarsReady,
    selectedBindings,
    showDeploymentValidationErrors,
    showValidationErrors,
  }
}

export function useDeployReleaseSubmission({
  deploymentCredentials,
  deploymentEnvVars,
}: {
  deploymentCredentials: CredentialSelectionInput[]
  deploymentEnvVars: EnvVarInput[]
}) {
  const { t } = useTranslation('deployments')
  const config = useDeployReadyFormConfig()
  const closeDeployDrawer = useSetAtom(closeDeployDrawerAtom)
  const promoteRelease = useMutation(consoleQuery.enterprise.deploymentService.promote.mutationOptions())
  const rollbackRelease = useMutation(consoleQuery.enterprise.deploymentService.rollback.mutationOptions())
  const isSubmitting = promoteRelease.isPending || rollbackRelease.isPending
  const selectedEnvironmentId = useAtomValue(deploySelectedEnvironmentIdAtom)
  const targetRelease = useAtomValue(deployTargetReleaseAtom)
  const targetReleaseId = useAtomValue(deployTargetReleaseIdAtom)

  function deployRelease() {
    if (!targetReleaseId || !selectedEnvironmentId)
      return

    const idempotencyKey = createDeploymentIdempotencyKey()
    const currentRelease = config.runtimeRows.find(row => row.environment.id === selectedEnvironmentId)?.currentRelease
    const action = releaseDeploymentAction({
      targetRelease,
      currentRelease,
      releaseRows: config.releases,
      isExistingRelease: true,
    })
    const mutationOptions = {
      onSuccess: () => {
        closeDeployDrawer()
      },
      onError: () => {
        toast.error(t('deployDrawer.deployFailed'))
      },
    }

    if (action === 'rollback') {
      rollbackRelease.mutate(
        {
          params: {
            appInstanceId: config.appInstanceId,
            environmentId: selectedEnvironmentId,
          },
          body: {
            appInstanceId: config.appInstanceId,
            environmentId: selectedEnvironmentId,
            targetReleaseId,
            idempotencyKey,
          },
        },
        mutationOptions,
      )
      return
    }

    promoteRelease.mutate(
      {
        params: {
          appInstanceId: config.appInstanceId,
          environmentId: selectedEnvironmentId,
        },
        body: {
          appInstanceId: config.appInstanceId,
          environmentId: selectedEnvironmentId,
          releaseId: targetReleaseId,
          credentials: deploymentCredentials,
          envVars: deploymentEnvVars.length > 0 ? deploymentEnvVars : undefined,
          idempotencyKey,
        },
      },
      mutationOptions,
    )
  }

  return {
    deployRelease,
    isSubmitting,
  }
}

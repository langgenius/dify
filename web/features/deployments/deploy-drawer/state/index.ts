'use client'

import type {
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
} from '../../shared/components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '../../shared/components/runtime-credential-bindings-utils'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithMutation, atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { envVarBindingSlotFromContract } from '../../shared/components/env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '../../shared/components/runtime-credential-bindings-utils'
import { createDeploymentIdempotencyKey } from '../../shared/domain/idempotency'
import { releaseDeploymentAction } from '../../shared/domain/release-action'

type OpenDeployDrawerParams = {
  appInstanceId: string
  environmentId?: string
  releaseId?: string
}

export const deployDrawerOpenAtom = atom(false)
export const deployDrawerAppInstanceIdAtom = atom<string | undefined>(undefined)
export const deployDrawerEnvironmentIdAtom = atom<string | undefined>(undefined)
export const deployDrawerReleaseIdAtom = atom<string | undefined>(undefined)
export const deployFormAppInstanceIdAtom = atom<string | undefined>(undefined)

export const openDeployDrawerAtom = atom(null, (_get, set, params: OpenDeployDrawerParams) => {
  set(deployDrawerAppInstanceIdAtom, params.appInstanceId)
  set(deployDrawerEnvironmentIdAtom, params.environmentId)
  set(deployDrawerReleaseIdAtom, params.releaseId)
  set(deployDrawerOpenAtom, true)
})

export const closeDeployDrawerAtom = atom(null, (_get, set) => {
  set(deployDrawerOpenAtom, false)
  set(deployDrawerAppInstanceIdAtom, undefined)
  set(deployDrawerEnvironmentIdAtom, undefined)
  set(deployDrawerReleaseIdAtom, undefined)
})

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

export const releaseDeploymentViewQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deployFormAppInstanceIdAtom)

  return consoleQuery.enterprise.releaseService.computeReleaseDeploymentView.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
  })
})

const selectedEnvIdAtom = atom<string | undefined>(undefined)
const selectedReleaseIdAtom = atom<string | undefined>(undefined)
const manualBindingsAtom = atom<RuntimeCredentialBindingSelections>({})
export const deployEnvVarValuesAtom = atom<EnvVarValues>({})
const showValidationErrorsAtom = atom(false)
export const deployReadyFormLocalAtoms = [
  selectedEnvIdAtom,
  selectedReleaseIdAtom,
  manualBindingsAtom,
  deployEnvVarValuesAtom,
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
  set(deployEnvVarValuesAtom, {})
  set(showValidationErrorsAtom, false)
})

export const selectDeployEnvironmentAtom = atom(null, (_get, set, environmentId: string) => {
  set(selectedEnvIdAtom, environmentId)
  set(resetDeployBindingsAtom)
})

export const selectDeployReleaseAtom = atom(null, (_get, set, releaseId: string) => {
  set(selectedReleaseIdAtom, releaseId)
  set(resetDeployBindingsAtom)
})

export const showDeployValidationErrorsAtom = atom(null, (_get, set) => {
  set(showValidationErrorsAtom, true)
})

export const deployShowValidationErrorsAtom = atom((get) => {
  return get(showValidationErrorsAtom)
})

const deployPresetReleaseAtom = atom((get) => {
  const config = formConfig(get)
  return config.presetReleaseId ? config.releases.find(r => r.id === config.presetReleaseId) : undefined
})

export const deployDisplayedReleaseAtom = atom((get): Release | undefined => {
  return get(deployPresetReleaseAtom)
})

export const deployIsExistingReleaseAtom = atom((get) => {
  const config = formConfig(get)
  return Boolean(config.presetReleaseId)
})

export const deployReleaseRowsAtom = atom((get) => {
  return formConfig(get).releases
})

export const deployReleaseEmptyLabelAtom = atom((get) => {
  return formConfig(get).releaseEmptyLabel
})

export const deployEnvironmentRowsAtom = atom((get) => {
  return formConfig(get).environments
})

export const deployLockedEnvironmentIdAtom = atom((get) => {
  return formConfig(get).lockedEnvId
})

export const deploySelectedEnvironmentIdAtom = atom((get) => {
  const config = formConfig(get)
  return get(selectedEnvIdAtom) ?? config.lockedEnvId ?? config.environments[0]?.id
})

const deploySelectedEnvironmentAtom = atom((get) => {
  const config = formConfig(get)
  const selectedEnvironmentId = get(deploySelectedEnvironmentIdAtom)
  return selectedEnvironmentId
    ? config.environments.find(env => env.id === selectedEnvironmentId)
    : undefined
})

export const deploySelectedReleaseIdAtom = atom((get) => {
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

export const deployLockedEnvironmentAtom = atom((get) => {
  const config = formConfig(get)
  return config.lockedEnvId
    ? config.environments.find(environment => environment.id === config.lockedEnvId)
    : undefined
})

export const deployTargetReleaseIdAtom = atom((get) => {
  const targetRelease = get(deployTargetReleaseAtom)
  return targetRelease?.id ?? get(deploySelectedReleaseIdAtom)
})

export const deployHasSelectedEnvironmentAtom = atom((get) => {
  return Boolean(get(deploySelectedEnvironmentAtom))
})

const releaseDeploymentOptionsQueryAtom = atomWithQuery((get) => {
  const hasSelectedEnvironment = get(deployHasSelectedEnvironmentAtom)
  const releaseId = get(deployTargetReleaseIdAtom)
  const selectedEnvironmentId = get(deploySelectedEnvironmentIdAtom)
  const hasRequiredInput = Boolean(releaseId && selectedEnvironmentId)

  return consoleQuery.enterprise.releaseService.computeDeploymentOptions.queryOptions({
    input: releaseId && selectedEnvironmentId
      ? {
          body: {
            releaseId,
            environmentId: selectedEnvironmentId,
          },
        }
      : skipToken,
    enabled: hasRequiredInput && hasSelectedEnvironment,
    retry: false,
  })
})

export const deployBindingSlotsAtom = atom((get) => {
  const deploymentOptionsQuery = get(releaseDeploymentOptionsQueryAtom)

  return deploymentOptionsQuery.data?.options.credentialSlots.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
})

export const deployEnvVarSlotsAtom = atom((get): EnvVarBindingSlot[] => {
  const deploymentOptionsQuery = get(releaseDeploymentOptionsQueryAtom)

  return deploymentOptionsQuery.data?.options.envVarSlots.flatMap((slot): EnvVarBindingSlot[] => {
    const bindingSlot = envVarBindingSlotFromContract(slot)
    return bindingSlot ? [bindingSlot] : []
  }) ?? []
})

export const deployIsBindingOptionsLoadingAtom = atom((get) => {
  const deploymentOptionsQuery = get(releaseDeploymentOptionsQueryAtom)
  const releaseId = get(deployTargetReleaseIdAtom)

  return Boolean(
    releaseId
    && get(deployHasSelectedEnvironmentAtom)
    && (deploymentOptionsQuery.isLoading || deploymentOptionsQuery.isFetching),
  )
})

export const deployHasBindingOptionsErrorAtom = atom((get) => {
  return get(releaseDeploymentOptionsQueryAtom).isError
})

const deployIsBindingOptionsReadyAtom = atom((get) => {
  const deploymentOptionsQuery = get(releaseDeploymentOptionsQueryAtom)
  const releaseId = get(deployTargetReleaseIdAtom)

  return Boolean(
    releaseId
    && get(deployHasSelectedEnvironmentAtom)
    && deploymentOptionsQuery.data
    && !get(deployIsBindingOptionsLoadingAtom)
    && !get(deployHasBindingOptionsErrorAtom),
  )
})

function deployEnvVarValueSource(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined) {
  return selection?.valueSource
    ?? (slot.hasLastValue
      ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
      : slot.hasDefaultValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
        : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)
}

function deployEnvVarInput(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined): EnvVarInput[] {
  const valueSource = deployEnvVarValueSource(slot, selection)

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
}

function deployEnvVarSelectionReady(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined) {
  const valueSource = deployEnvVarValueSource(slot, selection)

  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
    return Boolean(slot.hasLastValue)
  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
    return Boolean(slot.hasDefaultValue)
  if (!selection?.value)
    return false

  return slot.valueType !== 'number' || !Number.isNaN(Number(selection.value))
}

export const deploySelectedBindingsAtom = atom((get) => {
  return selectedRuntimeCredentialSelections(get(deployBindingSlotsAtom), get(manualBindingsAtom))
})

const deployDeploymentCredentialsAtom = atom((get) => {
  return selectedDeploymentRuntimeCredentials(get(deployBindingSlotsAtom), get(deploySelectedBindingsAtom))
})

const deployDeploymentEnvVarsAtom = atom((get) => {
  const envVarValues = get(deployEnvVarValuesAtom)

  return get(deployEnvVarSlotsAtom).flatMap(slot => deployEnvVarInput(slot, envVarValues[slot.key]))
})

const deployRequiredBindingsReadyAtom = atom((get) => {
  const selectedBindings = get(deploySelectedBindingsAtom)

  return get(deployBindingSlotsAtom).every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, selectedBindings[runtimeCredentialSlotKey(slot)]),
  )
})

const deployRequiredEnvVarsReadyAtom = atom((get) => {
  const envVarValues = get(deployEnvVarValuesAtom)

  return get(deployEnvVarSlotsAtom).every(slot =>
    deployEnvVarSelectionReady(slot, envVarValues[slot.key]),
  )
})

export const selectDeployBindingAtom = atom(null, (get, set, slot: string, value: string) => {
  set(manualBindingsAtom, {
    ...get(manualBindingsAtom),
    [slot]: value,
  })
})

export const setDeployEnvVarAtom = atom(null, (get, set, key: string, value: EnvVarValueSelection) => {
  set(deployEnvVarValuesAtom, {
    ...get(deployEnvVarValuesAtom),
    [key]: value,
  })
})

const promoteReleaseMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.deploymentService.promote.mutationOptions(),
)

const rollbackReleaseMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.deploymentService.rollback.mutationOptions(),
)

export const isDeployReleaseSubmittingAtom = atom((get) => {
  return get(promoteReleaseMutationAtom).isPending || get(rollbackReleaseMutationAtom).isPending
})

export const canAttemptDeployAtom = atom((get) => {
  return Boolean(
    get(deploySelectedEnvironmentIdAtom)
    && get(deploySelectedEnvironmentAtom)
    && get(deployTargetReleaseIdAtom)
    && get(deployIsBindingOptionsReadyAtom)
    && !get(isDeployReleaseSubmittingAtom),
  )
})

export const canSubmitDeployAtom = atom((get) => {
  return Boolean(
    get(canAttemptDeployAtom)
    && get(deployRequiredBindingsReadyAtom)
    && get(deployRequiredEnvVarsReadyAtom),
  )
})

export const deployReleaseSubmissionAtom = atom(null, (get, set, {
  deployFailedMessage,
}: {
  deployFailedMessage: string
}) => {
  const config = formConfig(get)
  const selectedEnvironmentId = get(deploySelectedEnvironmentIdAtom)
  const targetRelease = get(deployTargetReleaseAtom)
  const targetReleaseId = get(deployTargetReleaseIdAtom)

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
      set(closeDeployDrawerAtom)
    },
    onError: () => {
      toast.error(deployFailedMessage)
    },
  }

  if (action === 'rollback') {
    get(rollbackReleaseMutationAtom).mutate(
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

  const deploymentEnvVars = get(deployDeploymentEnvVarsAtom)
  get(promoteReleaseMutationAtom).mutate(
    {
      params: {
        appInstanceId: config.appInstanceId,
        environmentId: selectedEnvironmentId,
      },
      body: {
        appInstanceId: config.appInstanceId,
        environmentId: selectedEnvironmentId,
        releaseId: targetReleaseId,
        credentials: get(deployDeploymentCredentialsAtom),
        envVars: deploymentEnvVars.length > 0 ? deploymentEnvVars : undefined,
        idempotencyKey,
      },
    },
    mutationOptions,
  )
})

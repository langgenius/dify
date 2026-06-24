'use client'

import type {
  DeployRequest,
  EnvVarInput,
} from '@dify/contracts/enterprise/types.gen'
import type { Getter } from 'jotai/vanilla'
import type { EnvVarBindingSlot, EnvVarValues, EnvVarValueSelection } from '@/features/deployments/components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/components/runtime-credential-bindings-utils'
import type { UnsupportedDslNode } from '@/features/deployments/shared/domain/error'
import type { App } from '@/types/app'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { keepPreviousData, queryOptions, skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithMutation, atomWithQuery } from 'jotai-tanstack-query'
import { envVarBindingSlotFromContract, envVarBindingValueType } from '@/features/deployments/components/env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import {
  dslAppName,
  dslEnvVarSlots,
  encodeDslContent,
  isWorkflowDsl,
} from '@/features/deployments/shared/domain/dsl'
import { unsupportedDslNodeError } from '@/features/deployments/shared/domain/error'
import { isDeploymentDslImportEnabled } from '@/features/deployments/shared/domain/feature-flags'
import { createDeploymentIdempotencyKey } from '@/features/deployments/shared/domain/idempotency'
import {
  DEPLOYMENT_PAGE_SIZE,
  getNextPageParamFromPagination,
  SOURCE_APPS_PAGE_SIZE,
} from '@/features/deployments/shared/domain/pagination'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { environmentMatchesIdentifier } from './environment'

export type GuideMethod = 'bindApp' | 'importDsl'
export type GuideStep = 'source' | 'release' | 'target'
export type WorkflowSourceApp = App & { mode: Extract<AppModeEnum, 'workflow'> }

function deploymentGuideMethod(method: GuideMethod): GuideMethod {
  return method === 'importDsl' && !isDeploymentDslImportEnabled
    ? 'bindApp'
    : method
}

const RANDOM_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const RANDOM_SUFFIX_LENGTH = 4
const RANDOM_SUFFIX_FALLBACK_LENGTH = 6
const RANDOM_SUFFIX_MAX_ATTEMPTS = 16

function randomLetterCombination(length: number) {
  const randomValues = new Uint8Array(length)

  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(randomValues)
  }
  else {
    randomValues.forEach((_, index) => {
      randomValues[index] = Math.floor(Math.random() * 256)
    })
  }

  return Array.from(randomValues, value => RANDOM_SUFFIX_ALPHABET[value % RANDOM_SUFFIX_ALPHABET.length]).join('')
}

function availableInstanceName(sourceName: string, existingNameSet: Set<string>) {
  if (!existingNameSet.has(sourceName))
    return sourceName

  for (let attempt = 0; attempt < RANDOM_SUFFIX_MAX_ATTEMPTS; attempt++) {
    const candidate = `${sourceName}-${randomLetterCombination(RANDOM_SUFFIX_LENGTH)}`
    if (!existingNameSet.has(candidate))
      return candidate
  }

  return `${sourceName}-${randomLetterCombination(RANDOM_SUFFIX_FALLBACK_LENGTH)}`
}

function envVarValueSource(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined) {
  return selection?.valueSource
    ?? (slot.hasDefaultValue
      ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
      : slot.hasLastValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
        : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)
}

function envVarSelectionReady(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined) {
  const valueSource = envVarValueSource(slot, selection)

  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
    return Boolean(slot.hasLastValue)
  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
    return Boolean(slot.hasDefaultValue)
  if (!selection?.value)
    return false

  return slot.valueType !== 'number' || !Number.isNaN(Number(selection.value))
}

function envVarInput(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined): EnvVarInput[] {
  const valueSource = envVarValueSource(slot, selection)

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

// Workflow primitives
export const stepAtom = atom<GuideStep>('source')
export const methodAtom = atom<GuideMethod>('bindApp')
export const effectiveMethodAtom = atom(get => deploymentGuideMethod(get(methodAtom)))

// Source primitives
export const sourceSearchTextAtom = atom('')
export const selectedAppAtom = atom<WorkflowSourceApp | undefined>(undefined)

// DSL primitives and derived state
export const dslFileAtom = atom<File | undefined>(undefined)
const dslFileReadVersionAtom = atom(0)

const dslFileContentQueryAtom = atomWithQuery((get) => {
  const file = get(dslFileAtom)
  const fileReadVersion = get(dslFileReadVersionAtom)

  return queryOptions({
    queryKey: [
      'createGuideDslFileContent',
      fileReadVersion,
      file,
      file?.name ?? '',
      file?.size ?? 0,
      file?.lastModified ?? 0,
    ],
    queryFn: async () => file ? await file.text() : '',
    enabled: Boolean(file),
    retry: false,
  })
})

const dslContentAtom = atom((get) => {
  return get(dslFileContentQueryAtom).data ?? ''
})

export const isReadingDslAtom = atom((get) => {
  const file = get(dslFileAtom)
  const dslFileContentQuery = get(dslFileContentQueryAtom)

  return Boolean(file && (dslFileContentQuery.isLoading || dslFileContentQuery.isFetching))
})

export const dslReadErrorAtom = atom((get) => {
  return Boolean(get(dslFileAtom) && get(dslFileContentQueryAtom).isError)
})

export const dslDefaultAppNameAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return dslContent ? dslAppName(dslContent) : ''
})

export const dslUnsupportedModeAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return get(effectiveMethodAtom) === 'importDsl'
    && Boolean(dslContent.trim())
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !isWorkflowDsl(dslContent)
})

const importDslReadyAtom = atom((get) => {
  return Boolean(get(dslContentAtom).trim())
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !get(dslUnsupportedModeAtom)
})

// Release primitives
export const instanceNameAtom = atom('')
export const instanceDescriptionAtom = atom('')
export const releaseNameAtom = atom('')
export const releaseDescriptionAtom = atom('')
const autoFilledInstanceNameAtom = atom('')
const autoFilledReleaseNameAtom = atom('')

// Target primitives
export const selectedEnvironmentIdAtom = atom('')
const manualBindingSelectionsAtom = atom<RuntimeCredentialBindingSelections>({})
export const envVarValuesAtom = atom<EnvVarValues>({})

// Submission primitives
const submissionUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])
const isCreatingDeploymentAtom = atom(false)
export const isCreatingReleaseOnlyAtom = atom(false)

export const isSubmittingDeploymentGuideAtom = atom(get => (
  get(isCreatingDeploymentAtom) || get(isCreatingReleaseOnlyAtom)
))

// Query and remote data
export const sourceAppsQueryAtom = atomWithInfiniteQuery((get) => {
  const sourceSearchText = get(sourceSearchTextAtom)

  return consoleQuery.apps.list.infiniteOptions({
    input: pageParam => ({
      query: {
        page: Number(pageParam),
        limit: SOURCE_APPS_PAGE_SIZE,
        name: sourceSearchText,
        mode: AppModeEnum.WORKFLOW,
      },
    }),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    enabled: get(effectiveMethodAtom) === 'bindApp',
  })
})

export const effectiveSelectedAppAtom = atom((get) => {
  const selectedApp = get(selectedAppAtom)
  if (selectedApp)
    return selectedApp

  const sourceAppsQuery = get(sourceAppsQueryAtom)
  if (sourceAppsQuery.isPlaceholderData)
    return undefined

  const sourceApps = (sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []) as WorkflowSourceApp[]

  return sourceApps[0]
})

function sourceReady(get: Getter) {
  const method = get(effectiveMethodAtom)

  return method === 'importDsl'
    ? get(importDslReadyAtom)
    : Boolean(get(effectiveSelectedAppAtom)?.id)
}

const existingInstanceNamesQueryAtom = atomWithInfiniteQuery(() =>
  consoleQuery.enterprise.appInstanceService.listAppInstances.infiniteOptions({
    input: pageParam => ({
      query: {
        pageNumber: Number(pageParam),
        resultsPerPage: DEPLOYMENT_PAGE_SIZE,
      },
    }),
    getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
    initialPageParam: 1,
    placeholderData: keepPreviousData,
  }),
)

const instanceNameConflictQueryAtom = atomWithQuery((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()

  return consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
    input: {
      query: {
        pageNumber: 1,
        resultsPerPage: 1,
        displayName: submittedInstanceName,
      },
    },
    enabled: Boolean(submittedInstanceName),
  })
})

export const deployableEnvironmentsQueryAtom = atomWithQuery((get) => {
  return consoleQuery.enterprise.environmentService.listEnvironments.queryOptions({
    input: {
      query: {
        // The guide offers every deployable environment at once; environment
        // count is capped well below the 100-per-page maximum.
        pageNumber: 1,
        resultsPerPage: 100,
      },
    },
    enabled: sourceReady(get),
  })
})

const precheckReleaseQueryAtom = atomWithQuery((get) => {
  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const dslContent = get(dslContentAtom)
  const encodedDslContent = dslContent.trim() ? encodeDslContent(dslContent) : undefined
  const enabled = sourceReady(get)

  // PrecheckRelease takes exactly one source arm (dsl | sourceAppId).
  const precheckReleaseQueryOptions = method === 'importDsl'
    ? consoleQuery.enterprise.releaseService.precheckRelease.queryOptions({
        input: encodedDslContent
          ? {
              body: {
                dsl: encodedDslContent,
              },
            }
          : skipToken,
        enabled,
        retry: false,
      })
    : consoleQuery.enterprise.releaseService.precheckRelease.queryOptions({
        input: effectiveSelectedApp?.id
          ? {
              body: {
                sourceAppId: effectiveSelectedApp.id,
              },
            }
          : skipToken,
        enabled: enabled && Boolean(effectiveSelectedApp?.id),
        retry: false,
      })

  return precheckReleaseQueryOptions
})

function precheckReleaseReady(get: Getter) {
  const precheckReleaseQuery = get(precheckReleaseQueryAtom)

  return sourceReady(get)
    && precheckReleaseQuery.isSuccess
    && Boolean(precheckReleaseQuery.data?.canCreate)
    && (precheckReleaseQuery.data?.unsupportedNodes.length ?? 0) === 0
    && get(submissionUnsupportedDslNodesAtom).length === 0
}

export const deploymentOptionsQueryAtom = atomWithQuery((get) => {
  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const dslContent = get(dslContentAtom)
  const encodedDslContent = dslContent.trim() ? encodeDslContent(dslContent) : undefined
  const enabled = precheckReleaseReady(get)

  // ComputeDeploymentOptions takes exactly one source arm (dsl | sourceAppId | releaseId).
  const deploymentOptionsQueryOptions = method === 'importDsl'
    ? consoleQuery.enterprise.releaseService.computeDeploymentOptions.queryOptions({
        input: encodedDslContent
          ? {
              body: {
                dsl: encodedDslContent,
              },
            }
          : skipToken,
        enabled,
        retry: false,
      })
    : consoleQuery.enterprise.releaseService.computeDeploymentOptions.queryOptions({
        input: effectiveSelectedApp?.id
          ? {
              body: {
                sourceAppId: effectiveSelectedApp.id,
              },
            }
          : skipToken,
        enabled: enabled && Boolean(effectiveSelectedApp?.id),
        retry: false,
      })

  return deploymentOptionsQueryOptions
})

// Unsupported DSL state
export const unsupportedDslNodesAtom = atom((get): UnsupportedDslNode[] => {
  const submissionUnsupportedDslNodes = get(submissionUnsupportedDslNodesAtom)
  if (submissionUnsupportedDslNodes.length > 0)
    return submissionUnsupportedDslNodes

  if (!sourceReady(get))
    return []

  return get(precheckReleaseQueryAtom).data?.unsupportedNodes ?? []
})

const precheckReleaseReadyAtom = atom((get) => {
  return precheckReleaseReady(get)
})

const deploymentOptionsReadyAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return sourceReady(get)
    && get(precheckReleaseReadyAtom)
    && deploymentOptionsQuery.isSuccess
})

const deploymentOptionsContentCheckedAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)
  const precheckReleaseQuery = get(precheckReleaseQueryAtom)
  const isLoadingOptions = deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data)
  const isCheckingReleaseContent = precheckReleaseQuery.isLoading || (precheckReleaseQuery.isFetching && !precheckReleaseQuery.data)

  if (!sourceReady(get) || isCheckingReleaseContent || isLoadingOptions)
    return false

  return get(precheckReleaseReadyAtom) && deploymentOptionsQuery.isSuccess
})

export const sourceCanGoNextAtom = atom((get) => {
  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const importDslReady = method === 'importDsl' && get(importDslReadyAtom)
  const bindAppReady = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)

  return (importDslReady || bindAppReady) && get(deploymentOptionsContentCheckedAtom)
})

export const setSourceSearchTextAtom = atom(null, (get, set, value: string) => {
  if (get(sourceSearchTextAtom) === value)
    return

  set(sourceSearchTextAtom, value)
  set(selectedAppAtom, undefined)
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])
})

export const selectSourceAppAtom = atom(null, (_get, set, app: WorkflowSourceApp) => {
  set(selectedAppAtom, app)
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])
})

export const continueFromSourceAtom = atom(null, (get, set, {
  defaultDslAppName,
  defaultReleaseName,
}: {
  defaultDslAppName: string
  defaultReleaseName: string
}) => {
  if (!get(sourceCanGoNextAtom))
    return

  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  if (method === 'bindApp' && effectiveSelectedApp)
    set(selectSourceAppAtom, effectiveSelectedApp)

  const sourceName = method === 'importDsl'
    ? get(dslDefaultAppNameAtom) || defaultDslAppName
    : effectiveSelectedApp?.name
  const nextInstanceName = sourceName?.trim()

  if (nextInstanceName) {
    const currentInstanceName = get(instanceNameAtom).trim()
    const autoFilledInstanceName = get(autoFilledInstanceNameAtom)
    const existingInstanceNamesQuery = get(existingInstanceNamesQueryAtom)
    const existingNameSet = new Set(
      existingInstanceNamesQuery.data?.pages.flatMap(page =>
        page.appInstances.flatMap((appInstance) => {
          const name = appInstance.displayName.trim()

          return name ? [name] : []
        }),
      ) ?? [],
    )

    if (!currentInstanceName || currentInstanceName === autoFilledInstanceName) {
      const nextAvailableInstanceName = availableInstanceName(nextInstanceName, existingNameSet)
      set(instanceNameAtom, nextAvailableInstanceName)
      set(autoFilledInstanceNameAtom, nextAvailableInstanceName)
    }
  }

  const currentReleaseName = get(releaseNameAtom).trim()
  const autoFilledReleaseName = get(autoFilledReleaseNameAtom)
  if (!currentReleaseName || currentReleaseName === autoFilledReleaseName) {
    set(releaseNameAtom, defaultReleaseName)
    set(autoFilledReleaseNameAtom, defaultReleaseName)
  }
  set(stepAtom, 'release')
})

// DSL actions
export const selectDslFileAtom = atom(null, (get, set, dslFile?: File) => {
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])

  set(dslFileReadVersionAtom, get(dslFileReadVersionAtom) + 1)
  set(dslFileAtom, dslFile)
})

// Release derived state and actions
export const hasInstanceNameConflictAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)
  const existingInstanceNamesQuery = get(existingInstanceNamesQueryAtom)
  const existingInstanceNames = existingInstanceNamesQuery.data?.pages.flatMap(page =>
    page.appInstances.flatMap((appInstance) => {
      const name = appInstance.displayName.trim()

      return name ? [name] : []
    }),
  ) ?? []

  return Boolean(
    submittedInstanceName
    && (
      existingInstanceNames.includes(submittedInstanceName)
      || (instanceNameConflictQuery.data?.appInstances.some(appInstance => appInstance.displayName.trim() === submittedInstanceName) ?? false)
    ),
  )
})

const submittedReleaseReadyAtom = atom((get) => {
  return Boolean(sourceReady(get) && get(instanceNameAtom).trim() && get(releaseNameAtom).trim())
})

export const releaseCanGoNextAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return Boolean(get(submittedReleaseReadyAtom))
    && !get(hasInstanceNameConflictAtom)
    && !(Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading)
    && get(deploymentOptionsContentCheckedAtom)
})

export const setInstanceNameAtom = atom(null, (_get, set, value: string) => {
  set(instanceNameAtom, value)
  set(autoFilledInstanceNameAtom, '')
  set(stepAtom, 'release')
})

export const setInstanceDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(instanceDescriptionAtom, value)
  set(stepAtom, 'release')
})

export const setReleaseNameAtom = atom(null, (_get, set, value: string) => {
  set(releaseNameAtom, value)
  set(autoFilledReleaseNameAtom, '')
  set(stepAtom, 'release')
})

export const setReleaseDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(releaseDescriptionAtom, value)
  set(stepAtom, 'release')
})

export const continueFromReleaseAtom = atom(null, (get, set) => {
  if (!get(releaseCanGoNextAtom))
    return

  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(stepAtom, 'target')
})

// Target derived state and actions
export const deployableEnvironmentsAtom = atom((get) => {
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)

  return sourceReady(get)
    ? deployableEnvironmentsQuery.data?.environments ?? []
    : []
})

const deployableEnvironmentsReadyAtom = atom((get) => {
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)

  return sourceReady(get) && deployableEnvironmentsQuery.isSuccess
})

export const effectiveSelectedEnvironmentIdAtom = atom((get) => {
  return get(selectedEnvironmentIdAtom) || get(deployableEnvironmentsAtom)[0]?.id
})

export const deploymentTargetBindingSlotsAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return sourceReady(get)
    ? deploymentOptionsQuery.data?.options?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
})

export const deploymentTargetBindingSelectionsAtom = atom((get) => {
  return selectedRuntimeCredentialSelections(
    get(deploymentTargetBindingSlotsAtom),
    get(manualBindingSelectionsAtom),
  )
})

const requiredBindingsReadyAtom = atom((get) => {
  const bindingSelections = get(deploymentTargetBindingSelectionsAtom)

  return get(deploymentTargetBindingSlotsAtom).every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]),
  )
})

export const deploymentTargetEnvVarSlotsAtom = atom((get) => {
  const method = get(effectiveMethodAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)
  const slots = sourceReady(get) ? deploymentOptionsQuery.data?.options?.envVarSlots : undefined
  const dslContent = get(dslContentAtom)

  // Deployment options own the canonical slot list; DSL metadata only enriches import-DSL defaults.
  const deploymentOptionEnvVarSlots = slots?.flatMap((slot): EnvVarBindingSlot[] => {
    const bindingSlot = envVarBindingSlotFromContract(slot)
    return bindingSlot ? [bindingSlot] : []
  }) ?? []
  const dslEnvVarMetadataSlots = method === 'importDsl' && dslContent
    ? dslEnvVarSlots(dslContent).flatMap((slot) => {
        const key = slot.key.trim()
        if (!key)
          return []

        return [{
          key,
          ...(slot.description ? { description: slot.description } : {}),
          ...(slot.defaultValue !== undefined ? { defaultValue: slot.defaultValue, hasDefaultValue: true } : {}),
          ...(slot.valueType ? { valueType: envVarBindingValueType(slot.valueType) } : {}),
        }]
      })
    : []

  if (dslEnvVarMetadataSlots.length === 0)
    return deploymentOptionEnvVarSlots

  const metadataByKey = new Map(
    dslEnvVarMetadataSlots.map(slot => [slot.key, slot] as const),
  )

  return deploymentOptionEnvVarSlots.map((slot) => {
    const metadata = metadataByKey.get(slot.key)
    if (!metadata)
      return slot

    const nextSlot = { ...slot }

    if (!nextSlot.description && metadata.description)
      nextSlot.description = metadata.description
    if (!nextSlot.hasDefaultValue && metadata.defaultValue !== undefined) {
      nextSlot.defaultValue = metadata.defaultValue
      nextSlot.hasDefaultValue = true
    }
    if (nextSlot.valueType === 'string' && metadata.valueType)
      nextSlot.valueType = metadata.valueType

    return nextSlot
  })
})

const requiredEnvVarsReadyAtom = atom((get) => {
  const envVarValues = get(envVarValuesAtom)

  return get(deploymentTargetEnvVarSlotsAtom).every(slot =>
    envVarSelectionReady(slot, envVarValues[slot.key]),
  )
})

export const canDeployAtom = atom((get) => {
  const effectiveSelectedEnvironmentId = get(effectiveSelectedEnvironmentIdAtom)
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? get(deployableEnvironmentsAtom).find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined

  return Boolean(
    selectedEnvironment?.id
    && get(deployableEnvironmentsReadyAtom)
    && get(deploymentOptionsReadyAtom)
    && get(requiredBindingsReadyAtom)
    && get(requiredEnvVarsReadyAtom)
    && get(submittedReleaseReadyAtom),
  )
})

export const canSkipDeploymentAtom = atom((get) => {
  return get(submittedReleaseReadyAtom) && get(deploymentOptionsReadyAtom)
})

export const selectBindingAtom = atom(null, (get, set, slot: string, value: string) => {
  set(manualBindingSelectionsAtom, {
    ...get(manualBindingSelectionsAtom),
    [slot]: value,
  })
})

export const setEnvVarAtom = atom(null, (get, set, key: string, value: EnvVarValueSelection) => {
  set(envVarValuesAtom, {
    ...get(envVarValuesAtom),
    [key]: value,
  })
})

// Workflow actions
export const selectMethodAtom = atom(null, (_get, set, method: GuideMethod) => {
  set(methodAtom, deploymentGuideMethod(method))
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])
  set(stepAtom, 'source')
})

// Submission
const createAppInstanceMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions(),
)

const createReleaseMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.releaseService.createRelease.mutationOptions(),
)

const createInitialDeploymentMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.deploymentService.deploy.mutationOptions(),
)

export class CreateDeploymentGuideSubmissionBlockedError extends Error {
  reason: 'unsupportedDslMode' | 'deployFailed'

  constructor(reason: 'unsupportedDslMode' | 'deployFailed') {
    super(reason)
    this.reason = reason
    this.name = 'CreateDeploymentGuideSubmissionBlockedError'
  }
}

export const createDeploymentGuideSubmissionAtom = atom(null, async (get, set, {
  deployToEnvironment,
}: {
  deployToEnvironment: boolean
}) => {
  const method = get(effectiveMethodAtom)
  const dslContent = get(dslContentAtom)
  const submittedInstanceName = get(instanceNameAtom).trim()
  const submittedReleaseName = get(releaseNameAtom).trim()
  const submittedReleaseDescription = get(releaseDescriptionAtom).trim()

  if (get(isSubmittingDeploymentGuideAtom) || !get(submittedReleaseReadyAtom))
    return undefined

  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)
  const deploymentOptions = get(deploymentOptionsQueryAtom).data?.options
  const envVarSlots = get(deploymentTargetEnvVarSlotsAtom)
  const envVarValues = get(envVarValuesAtom)
  const bindingSlots = get(deploymentTargetBindingSlotsAtom)
  const bindingSelections = get(deploymentTargetBindingSelectionsAtom)
  const selectedEnvironmentId = get(selectedEnvironmentIdAtom)
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || get(deployableEnvironmentsAtom)[0]?.id
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? get(deployableEnvironmentsAtom).find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined

  if (deployToEnvironment && !selectedEnvironment && !selectedEnvironmentId.trim())
    return undefined
  if (method === 'bindApp' && !effectiveSelectedApp?.id)
    return undefined
  if (method === 'importDsl' && !dslContent.trim())
    return undefined
  if (method === 'importDsl' && !isWorkflowDsl(dslContent))
    throw new CreateDeploymentGuideSubmissionBlockedError('unsupportedDslMode')

  set(submissionUnsupportedDslNodesAtom, [])

  try {
    if (!deployToEnvironment) {
      if (!get(canSkipDeploymentAtom))
        return undefined

      set(isCreatingReleaseOnlyAtom, true)

      try {
        const createdAppInstance = await get(createAppInstanceMutationAtom).mutateAsync({
          body: {
            displayName: submittedInstanceName,
            description: get(instanceDescriptionAtom).trim() || undefined,
          },
        })
        const appInstanceId = createdAppInstance.appInstance.id

        if (method === 'importDsl') {
          await get(createReleaseMutationAtom).mutateAsync({
            body: {
              appInstanceId,
              dsl: encodeDslContent(dslContent),
              displayName: submittedReleaseName,
              description: submittedReleaseDescription || undefined,
              createAppInstance: false,
            },
          })

          return appInstanceId
        }

        if (!effectiveSelectedApp?.id)
          return undefined

        await get(createReleaseMutationAtom).mutateAsync({
          body: {
            appInstanceId,
            sourceAppId: effectiveSelectedApp.id,
            displayName: submittedReleaseName,
            description: submittedReleaseDescription || undefined,
            createAppInstance: false,
          },
        })

        return appInstanceId
      }
      finally {
        set(isCreatingReleaseOnlyAtom, false)
      }
    }

    if (!get(canDeployAtom))
      return undefined

    set(isCreatingDeploymentAtom, true)

    try {
      const selectedEnvironmentIdentifier = selectedEnvironmentId.trim()
      const freshSelectedEnvironment = selectedEnvironment || (
        selectedEnvironmentIdentifier
          ? (await deployableEnvironmentsQuery.refetch()).data?.environments.find(environment =>
              environmentMatchesIdentifier(environment, selectedEnvironmentIdentifier),
            )
          : undefined
      )
      const targetEnvironmentId = freshSelectedEnvironment?.id
      if (!targetEnvironmentId)
        throw new CreateDeploymentGuideSubmissionBlockedError('deployFailed')

      if (!get(requiredBindingsReadyAtom))
        throw new Error('Missing required deployment binding.')
      if (!get(requiredEnvVarsReadyAtom))
        throw new Error('Missing required deployment environment variable.')

      const envVars = envVarSlots.flatMap(slot => envVarInput(slot, envVarValues[slot.key]))
      const commonDeploymentRequest = {
        newAppInstance: {
          displayName: submittedInstanceName,
          description: get(instanceDescriptionAtom).trim() || undefined,
        },
        environmentId: targetEnvironmentId,
        releaseName: submittedReleaseName,
        releaseDescription: submittedReleaseDescription || undefined,
        credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
        envVars,
        idempotencyKey: createDeploymentIdempotencyKey(),
        expectedDslDigest: deploymentOptions?.dslDigest,
      } satisfies Omit<DeployRequest, 'dsl' | 'sourceAppId'>
      const deploymentRequest = method === 'importDsl'
        ? {
            ...commonDeploymentRequest,
            dsl: encodeDslContent(dslContent),
          }
        : effectiveSelectedApp?.id
          ? {
              ...commonDeploymentRequest,
              sourceAppId: effectiveSelectedApp.id,
            }
          : undefined
      if (!deploymentRequest)
        return undefined

      const response = await get(createInitialDeploymentMutationAtom).mutateAsync({
        body: deploymentRequest,
      })

      return response.appInstance.id
    }
    finally {
      set(isCreatingDeploymentAtom, false)
    }
  }
  catch (error) {
    const unsupportedError = await unsupportedDslNodeError(error)
    if (unsupportedError?.nodes.length) {
      set(submissionUnsupportedDslNodesAtom, unsupportedError.nodes)

      return undefined
    }

    throw error
  }
})

// Scoped local state
export const createDeploymentGuideScopedAtoms = [
  stepAtom,
  methodAtom,
  sourceSearchTextAtom,
  selectedAppAtom,
  dslFileAtom,
  dslFileReadVersionAtom,
  instanceNameAtom,
  instanceDescriptionAtom,
  releaseNameAtom,
  releaseDescriptionAtom,
  autoFilledInstanceNameAtom,
  autoFilledReleaseNameAtom,
  selectedEnvironmentIdAtom,
  manualBindingSelectionsAtom,
  envVarValuesAtom,
  submissionUnsupportedDslNodesAtom,
  isCreatingDeploymentAtom,
  isCreatingReleaseOnlyAtom,
]

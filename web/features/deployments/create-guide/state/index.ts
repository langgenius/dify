'use client'

import type {
  DeployReq,
  EnvVarInput,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvVarBindingSlot, EnvVarValues, EnvVarValueSelection } from '@/features/deployments/components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/components/runtime-credential-bindings-utils'
import type { UnsupportedDslNode } from '@/features/deployments/error'
import type { App } from '@/types/app'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { keepPreviousData } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithMutation, atomWithQuery } from 'jotai-tanstack-query'
import { loadable } from 'jotai/utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import {
  DEPLOYMENT_PAGE_SIZE,
  getNextPageParamFromPagination,
  SOURCE_APPS_PAGE_SIZE,
} from '@/features/deployments/data'
import {
  dslAppName,
  dslEnvVarSlots,
  encodeDslContent,
  isWorkflowDsl,
} from '@/features/deployments/dsl'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import { createDeploymentIdempotencyKey } from '@/features/deployments/idempotency'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'

export type GuideMethod = 'bindApp' | 'importDsl'
export type GuideStep = 'source' | 'release' | 'target'
export type WorkflowSourceApp = App & { mode: Extract<AppModeEnum, 'workflow'> }

const RANDOM_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const RANDOM_SUFFIX_LENGTH = 4
const RANDOM_SUFFIX_FALLBACK_LENGTH = 6
const RANDOM_SUFFIX_MAX_ATTEMPTS = 16

// Workflow primitives
export const stepAtom = atom<GuideStep>('source')
export const methodAtom = atom<GuideMethod>('bindApp')

// Source primitives
export const sourceSearchTextAtom = atom('')
export const selectedAppAtom = atom<WorkflowSourceApp | undefined>(undefined)

// DSL primitives and derived state
export const dslFileAtom = atom<File | undefined>(undefined)
const dslContentAtom = atom('')
export const isReadingDslAtom = atom(false)
export const dslReadErrorAtom = atom(false)
const dslReadTokenAtom = atom(0)

const hasDslContentAtom = atom(get => Boolean(get(dslContentAtom).trim()))

export const dslDefaultAppNameAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return dslContent ? dslAppName(dslContent) : ''
})

const encodedDslContentAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return get(hasDslContentAtom) ? encodeDslContent(dslContent) : ''
})

export const dslUnsupportedModeAtom = atom((get) => {
  const dslContent = get(dslContentAtom)
  const hasDslContent = get(hasDslContentAtom)

  return get(methodAtom) === 'importDsl'
    && hasDslContent
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !isWorkflowDsl(dslContent)
})

// Release primitives
export const instanceNameAtom = atom('')
export const instanceDescriptionAtom = atom('')
export const releaseNameAtom = atom('')
export const releaseDescriptionAtom = atom('')

// Target primitives
export const selectedEnvironmentIdAtom = atom('')
const manualBindingSelectionsAtom = atom<RuntimeCredentialBindingSelections>({})
export const envVarValuesAtom = atom<EnvVarValues>({})

const resetDeploymentTargetOptionsAtom = atom(null, (_get, set) => {
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
})

// Submission primitives
const submissionUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])
const isCreatingDeploymentAtom = atom(false)
export const isCreatingReleaseOnlyAtom = atom(false)

export const isSubmittingDeploymentGuideAtom = atom(get => (
  get(isCreatingDeploymentAtom) || get(isCreatingReleaseOnlyAtom)
))

// Query gate and remote data
const deploymentTargetQueryEnabledAtom = atom((get) => {
  const method = get(methodAtom)

  return (method === 'bindApp' && Boolean(get(selectedAppAtom)?.id))
    || (
      method === 'importDsl'
      && get(hasDslContentAtom)
      && !get(isReadingDslAtom)
      && !get(dslReadErrorAtom)
      && !get(dslUnsupportedModeAtom)
    )
})

export const sourceAppsQueryAtom = atomWithInfiniteQuery((get) => {
  const sourceSearchText = get(sourceSearchTextAtom)

  return {
    ...consoleQuery.apps.list.infiniteOptions({
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
    }),
    enabled: get(methodAtom) === 'bindApp',
  }
})

const existingInstanceNamesQueryAtom = atomWithInfiniteQuery(() => ({
  ...consoleQuery.enterprise.appInstanceService.listAppInstances.infiniteOptions({
    input: pageParam => ({
      query: {
        pageNumber: Number(pageParam),
        resultsPerPage: DEPLOYMENT_PAGE_SIZE,
      },
    }),
    getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
    initialPageParam: 1,
  }),
  placeholderData: keepPreviousData,
}))

const instanceNameConflictQueryAtom = atomWithQuery((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()

  return consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
    input: {
      query: {
        pageNumber: 1,
        resultsPerPage: 1,
        name: submittedInstanceName,
      },
    },
    enabled: Boolean(submittedInstanceName),
  })
})

export const deployableEnvironmentsQueryAtom = atomWithQuery((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)

  return consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled,
  })
})

export const deploymentOptionsQueryAtom = atomWithQuery((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const method = get(methodAtom)
  const selectedApp = get(selectedAppAtom)

  const deploymentOptionsQueryOptions = method === 'importDsl'
    ? consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
        input: {
          body: {
            dsl: get(encodedDslContentAtom),
          },
        },
        enabled,
      })
    : consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
        input: {
          body: {
            sourceAppId: selectedApp?.id ?? '',
          },
        },
        enabled: enabled && Boolean(selectedApp?.id),
      })

  // oRPC encodes input before TanStack can skip work, so keep a valid input shape and gate requests with enabled.
  return {
    ...deploymentOptionsQueryOptions,
    retry: false,
  }
})

export const sourceAppsAtom = atom((get) => {
  const sourceAppsQuery = get(sourceAppsQueryAtom)

  return (sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []) as WorkflowSourceApp[]
})

const existingInstanceNamesAtom = atom((get) => {
  const appInstancesQuery = get(existingInstanceNamesQueryAtom)

  return appInstancesQuery.data?.pages.flatMap(page =>
    page.data.flatMap((appInstance) => {
      const name = appInstance.name.trim()

      return name ? [name] : []
    }),
  ) ?? []
})

// Unsupported DSL state
const deploymentOptionsUnsupportedDslNodesAsyncAtom = atom(async (get): Promise<UnsupportedDslNode[]> => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  if (!enabled || !deploymentOptionsQuery.isError)
    return []

  return (await unsupportedDslNodeError(deploymentOptionsQuery.error))?.nodes ?? []
})

const deploymentOptionsUnsupportedDslNodesLoadableAtom = loadable(deploymentOptionsUnsupportedDslNodesAsyncAtom)

export const unsupportedDslNodesAtom = atom((get): UnsupportedDslNode[] => {
  const submissionUnsupportedDslNodes = get(submissionUnsupportedDslNodesAtom)
  if (submissionUnsupportedDslNodes.length > 0)
    return submissionUnsupportedDslNodes

  const deploymentOptionsUnsupportedDslNodes = get(deploymentOptionsUnsupportedDslNodesLoadableAtom)

  return deploymentOptionsUnsupportedDslNodes.state === 'hasData'
    ? deploymentOptionsUnsupportedDslNodes.data
    : []
})

// Source derived state and actions
export const effectiveSelectedAppAtom = atom((get) => {
  return get(selectedAppAtom) ?? get(sourceAppsAtom)[0]
})

export const sourceCanGoNextAtom = atom((get) => {
  const method = get(methodAtom)
  const importDslReady = method === 'importDsl'
    && get(hasDslContentAtom)
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !get(dslUnsupportedModeAtom)
  const bindAppReady = method === 'bindApp' && Boolean(get(effectiveSelectedAppAtom)?.id)

  return (importDslReady || bindAppReady) && get(unsupportedDslNodesAtom).length === 0
})

export const selectSourceAppAtom = atom(null, (_get, set, app: WorkflowSourceApp) => {
  set(selectedAppAtom, app)
  set(resetDeploymentTargetOptionsAtom)
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

  const method = get(methodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  if (method === 'bindApp' && effectiveSelectedApp)
    set(selectSourceAppAtom, effectiveSelectedApp)

  const sourceName = method === 'importDsl'
    ? get(dslDefaultAppNameAtom) || defaultDslAppName
    : effectiveSelectedApp?.name
  const nextInstanceName = sourceName?.trim()

  if (!get(instanceNameAtom).trim() && nextInstanceName) {
    const existingNameSet = new Set(get(existingInstanceNamesAtom))
    let availableInstanceName = nextInstanceName

    if (existingNameSet.has(nextInstanceName)) {
      const randomLetterCombination = (length: number) => {
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

      for (let attempt = 0; attempt < RANDOM_SUFFIX_MAX_ATTEMPTS; attempt++) {
        const candidate = `${nextInstanceName}-${randomLetterCombination(RANDOM_SUFFIX_LENGTH)}`
        if (!existingNameSet.has(candidate)) {
          availableInstanceName = candidate
          break
        }
      }

      if (availableInstanceName === nextInstanceName)
        availableInstanceName = `${nextInstanceName}-${randomLetterCombination(RANDOM_SUFFIX_FALLBACK_LENGTH)}`
    }

    set(instanceNameAtom, availableInstanceName)
  }
  if (!get(releaseNameAtom).trim())
    set(releaseNameAtom, defaultReleaseName)
  set(stepAtom, 'release')
})

// DSL actions
export const selectDslFileAtom = atom(null, async (get, set, dslFile?: File) => {
  set(resetDeploymentTargetOptionsAtom)
  set(submissionUnsupportedDslNodesAtom, [])

  // Token guard prevents a slow read from an older file from overwriting the newest selection.
  const dslReadToken = get(dslReadTokenAtom) + 1
  set(dslReadTokenAtom, dslReadToken)
  set(dslFileAtom, dslFile)
  set(dslContentAtom, '')
  set(isReadingDslAtom, Boolean(dslFile))
  set(dslReadErrorAtom, false)

  if (!dslFile)
    return

  try {
    const content = await dslFile.text()
    if (get(dslReadTokenAtom) !== dslReadToken)
      return

    set(dslContentAtom, content)
    set(dslReadErrorAtom, false)
  }
  catch {
    if (get(dslReadTokenAtom) !== dslReadToken)
      return

    set(dslContentAtom, '')
    set(dslReadErrorAtom, true)
  }
  finally {
    if (get(dslReadTokenAtom) === dslReadToken)
      set(isReadingDslAtom, false)
  }
})

// Release derived state and actions
export const hasInstanceNameConflictAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return Boolean(
    submittedInstanceName
    && (
      get(existingInstanceNamesAtom).includes(submittedInstanceName)
      || (instanceNameConflictQuery.data?.data.some(appInstance => appInstance.name.trim() === submittedInstanceName) ?? false)
    ),
  )
})

const submittedReleaseReadyAtom = atom((get) => {
  const method = get(methodAtom)
  const sourceReady = method === 'importDsl'
    ? get(hasDslContentAtom) && !get(isReadingDslAtom) && !get(dslReadErrorAtom) && !get(dslUnsupportedModeAtom)
    : Boolean(get(selectedAppAtom)?.id)
  const submittedInstanceName = get(instanceNameAtom).trim()
  const submittedReleaseName = get(releaseNameAtom).trim()

  return Boolean(sourceReady && submittedInstanceName && submittedReleaseName)
})

export const releaseCanGoNextAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return get(submittedReleaseReadyAtom)
    && !get(hasInstanceNameConflictAtom)
    && !(Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading)
    && get(unsupportedDslNodesAtom).length === 0
})

export const setInstanceNameAtom = atom(null, (_get, set, value: string) => {
  set(instanceNameAtom, value)
  set(stepAtom, 'release')
})

export const setInstanceDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(instanceDescriptionAtom, value)
  set(stepAtom, 'release')
})

export const setReleaseNameAtom = atom(null, (_get, set, value: string) => {
  set(releaseNameAtom, value)
  set(stepAtom, 'release')
})

export const setReleaseDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(releaseDescriptionAtom, value)
  set(stepAtom, 'release')
})

export const continueFromReleaseAtom = atom(null, (get, set) => {
  if (!get(releaseCanGoNextAtom))
    return

  set(resetDeploymentTargetOptionsAtom)
  set(stepAtom, 'target')
})

// Target derived state and actions
export const deployableEnvironmentsAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)

  return enabled
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
})

export const effectiveSelectedEnvironmentIdAtom = atom((get) => {
  return get(selectedEnvironmentIdAtom) || get(deployableEnvironmentsAtom)[0]?.id
})

const selectedDeploymentEnvironmentAtom = atom((get) => {
  const effectiveSelectedEnvironmentId = get(effectiveSelectedEnvironmentIdAtom)

  return effectiveSelectedEnvironmentId
    ? get(deployableEnvironmentsAtom).find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined
})

export const deploymentTargetBindingSlotsAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return enabled
    ? deploymentOptionsQuery.data?.options?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
})

export const deploymentTargetBindingSelectionsAtom = atom((get) => {
  return selectedRuntimeCredentialSelections(
    get(deploymentTargetBindingSlotsAtom),
    get(manualBindingSelectionsAtom),
  )
})

const deploymentTargetRequiredBindingsReadyAtom = atom((get) => {
  const bindingSlots = get(deploymentTargetBindingSlotsAtom)
  const bindingSelections = get(deploymentTargetBindingSelectionsAtom)

  return bindingSlots.every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]),
  )
})

export const deploymentTargetEnvVarSlotsAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)
  const slots = enabled ? deploymentOptionsQuery.data?.options?.envVarSlots : undefined
  const dslContent = get(dslContentAtom)
  const method = get(methodAtom)
  const valueType = (value?: string): EnvVarBindingSlot['valueType'] => (
    value === 'number' || value === 'secret' ? value : 'string'
  )

  // Deployment options own the canonical slot list; DSL metadata only enriches import-DSL defaults.
  const deploymentOptionEnvVarSlots = slots?.flatMap((slot): EnvVarBindingSlot[] => {
    const key = slot.key.trim()
    if (!key)
      return []

    return [{
      ...slot,
      key,
      valueType: valueType(slot.valueType),
    }]
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
          ...(slot.valueType ? { valueType: valueType(slot.valueType) } : {}),
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

const deploymentTargetRequiredEnvVarsReadyAtom = atom((get) => {
  const envVarValues = get(envVarValuesAtom)

  return get(deploymentTargetEnvVarSlotsAtom).every((slot) => {
    const selection = envVarValues[slot.key]
    const valueSource = selection?.valueSource
      ?? (slot.hasDefaultValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
        : slot.hasLastValue
          ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
          : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
      return Boolean(slot.hasLastValue)
    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
      return Boolean(slot.hasDefaultValue)
    if (!selection?.value)
      return false

    return slot.valueType !== 'number' || !Number.isNaN(Number(selection.value))
  })
})

const deploymentTargetReadyAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return enabled
    && !(deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
    && !deployableEnvironmentsQuery.isError
    && !(deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
    && !deploymentOptionsQuery.isError
    && get(unsupportedDslNodesAtom).length === 0
})

export const canDeployAtom = atom((get) => {
  return Boolean(
    get(selectedDeploymentEnvironmentAtom)?.id
    && get(deploymentTargetReadyAtom)
    && get(deploymentTargetRequiredBindingsReadyAtom)
    && get(deploymentTargetRequiredEnvVarsReadyAtom)
    && get(submittedReleaseReadyAtom),
  )
})

export const canSkipDeploymentAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return Boolean(
    get(submittedReleaseReadyAtom)
    && !deploymentOptionsQuery.isError
    && get(unsupportedDslNodesAtom).length === 0,
  )
})

const deploymentTargetSubmissionStateAtom = atom(get => ({
  bindingSelections: get(deploymentTargetBindingSelectionsAtom),
  bindingSlots: get(deploymentTargetBindingSlotsAtom),
  deployableEnvironmentsQuery: get(deployableEnvironmentsQueryAtom),
  deploymentOptions: get(deploymentOptionsQueryAtom).data?.options,
  envVarSlots: get(deploymentTargetEnvVarSlotsAtom),
  envVarValues: get(envVarValuesAtom),
  requiredEnvVarsReady: get(deploymentTargetRequiredEnvVarsReadyAtom),
  selectedEnvironment: get(selectedDeploymentEnvironmentAtom),
  selectedEnvironmentId: get(selectedEnvironmentIdAtom),
}))

export const selectBindingAtom = atom(null, (get, set, {
  slot,
  value,
}: {
  slot: string
  value: string
}) => {
  set(manualBindingSelectionsAtom, {
    ...get(manualBindingSelectionsAtom),
    [slot]: value,
  })
})

export const setEnvVarAtom = atom(null, (get, set, {
  key,
  value,
}: {
  key: string
  value: EnvVarValueSelection
}) => {
  set(envVarValuesAtom, {
    ...get(envVarValuesAtom),
    [key]: value,
  })
})

// Workflow actions
export const selectMethodAtom = atom(null, (_get, set, method: GuideMethod) => {
  set(methodAtom, method)
  set(resetDeploymentTargetOptionsAtom)
  set(submissionUnsupportedDslNodesAtom, [])
  set(stepAtom, 'source')
})

// Submission
const createDeploymentSubmissionDraftAtom = atom(get => ({
  dslContent: get(dslContentAtom),
  encodedDslContent: get(encodedDslContentAtom),
  hasDslContent: get(hasDslContentAtom),
  instanceDescription: get(instanceDescriptionAtom),
  method: get(methodAtom),
  submittedInstanceName: get(instanceNameAtom).trim(),
  submittedReleaseDescription: get(releaseDescriptionAtom).trim(),
  submittedReleaseName: get(releaseNameAtom).trim(),
}))

const createAppInstanceMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions(),
)

const createReleaseFromDslMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions(),
)

const createReleaseFromSourceAppMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions(),
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
  if (get(isSubmittingDeploymentGuideAtom) || !get(submittedReleaseReadyAtom))
    return undefined

  const submissionDraft = get(createDeploymentSubmissionDraftAtom)
  const effectiveSelectedApp = get(selectedAppAtom)
  const targetSubmissionState = get(deploymentTargetSubmissionStateAtom)

  if (deployToEnvironment && !targetSubmissionState.selectedEnvironment && !targetSubmissionState.selectedEnvironmentId?.trim())
    return undefined
  if (submissionDraft.method === 'bindApp' && !effectiveSelectedApp?.id)
    return undefined
  if (submissionDraft.method === 'importDsl' && !submissionDraft.hasDslContent)
    return undefined
  if (submissionDraft.method === 'importDsl' && !isWorkflowDsl(submissionDraft.dslContent))
    throw new CreateDeploymentGuideSubmissionBlockedError('unsupportedDslMode')

  set(submissionUnsupportedDslNodesAtom, [])

  try {
    if (!deployToEnvironment) {
      set(isCreatingReleaseOnlyAtom, true)

      try {
        const createdAppInstance = await get(createAppInstanceMutationAtom).mutateAsync({
          body: {
            name: submissionDraft.submittedInstanceName,
            description: submissionDraft.instanceDescription.trim() || undefined,
          },
        })
        const appInstanceId = createdAppInstance.appInstance.id

        if (submissionDraft.method === 'importDsl') {
          await get(createReleaseFromDslMutationAtom).mutateAsync({
            body: {
              appInstanceId,
              dsl: submissionDraft.encodedDslContent,
              name: submissionDraft.submittedReleaseName,
              description: submissionDraft.submittedReleaseDescription || undefined,
              createAppInstance: false,
            },
          })

          return appInstanceId
        }

        if (!effectiveSelectedApp?.id)
          return undefined

        await get(createReleaseFromSourceAppMutationAtom).mutateAsync({
          body: {
            appInstanceId,
            sourceAppId: effectiveSelectedApp.id,
            name: submissionDraft.submittedReleaseName,
            description: submissionDraft.submittedReleaseDescription || undefined,
            createAppInstance: false,
          },
        })

        return appInstanceId
      }
      finally {
        set(isCreatingReleaseOnlyAtom, false)
      }
    }

    const selectedEnvironmentIdentifier = targetSubmissionState.selectedEnvironmentId?.trim()
    const freshSelectedEnvironment = targetSubmissionState.selectedEnvironment || (
      selectedEnvironmentIdentifier
        ? (await targetSubmissionState.deployableEnvironmentsQuery.refetch()).data?.data.find(environment =>
            environmentMatchesIdentifier(environment, selectedEnvironmentIdentifier),
          )
        : undefined
    )
    const targetEnvironmentId = freshSelectedEnvironment?.id
    if (!targetEnvironmentId)
      throw new CreateDeploymentGuideSubmissionBlockedError('deployFailed')

    if (targetSubmissionState.bindingSlots.some(slot =>
      hasMissingRequiredRuntimeCredentialBinding(slot, targetSubmissionState.bindingSelections[runtimeCredentialSlotKey(slot)]),
    )) {
      throw new Error('Missing required deployment binding.')
    }
    if (!targetSubmissionState.requiredEnvVarsReady)
      throw new Error('Missing required deployment environment variable.')

    const envVars = targetSubmissionState.envVarSlots.flatMap((slot): EnvVarInput[] => {
      const selection = targetSubmissionState.envVarValues[slot.key]
      const valueSource = selection?.valueSource
        ?? (slot.hasDefaultValue
          ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
          : slot.hasLastValue
            ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
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
    const commonDeploymentRequest = {
      new: {
        name: submissionDraft.submittedInstanceName,
        description: submissionDraft.instanceDescription.trim() || undefined,
      },
      environmentId: targetEnvironmentId,
      releaseName: submissionDraft.submittedReleaseName,
      releaseDescription: submissionDraft.submittedReleaseDescription || undefined,
      credentials: selectedDeploymentRuntimeCredentials(targetSubmissionState.bindingSlots, targetSubmissionState.bindingSelections),
      envVars,
      idempotencyKey: createDeploymentIdempotencyKey(),
      expectedDslDigest: targetSubmissionState.deploymentOptions?.dslDigest,
    } satisfies Omit<DeployReq, 'dsl' | 'sourceAppId'>
    const deploymentRequest = submissionDraft.method === 'importDsl'
      ? {
          ...commonDeploymentRequest,
          dsl: submissionDraft.encodedDslContent,
        }
      : effectiveSelectedApp?.id
        ? {
            ...commonDeploymentRequest,
            sourceAppId: effectiveSelectedApp.id,
          }
        : undefined
    if (!deploymentRequest)
      return undefined

    set(isCreatingDeploymentAtom, true)

    const response = await get(createInitialDeploymentMutationAtom).mutateAsync({
      body: deploymentRequest,
    }).finally(() => {
      set(isCreatingDeploymentAtom, false)
    })

    return response.appInstance.id
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
  dslContentAtom,
  isReadingDslAtom,
  dslReadErrorAtom,
  dslReadTokenAtom,
  instanceNameAtom,
  instanceDescriptionAtom,
  releaseNameAtom,
  releaseDescriptionAtom,
  selectedEnvironmentIdAtom,
  manualBindingSelectionsAtom,
  envVarValuesAtom,
  submissionUnsupportedDslNodesAtom,
  isCreatingDeploymentAtom,
  isCreatingReleaseOnlyAtom,
]

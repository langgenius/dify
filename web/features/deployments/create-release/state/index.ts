'use client'

import type {
  CreateReleaseResponse,
  ListReleasesResponse,
  ListReleaseSummariesResponse,
} from '@dify/contracts/enterprise/types.gen'
import type { Getter } from 'jotai/vanilla'
import type { UnsupportedDslNode } from '../../shared/domain/error'
import type { App } from '@/types/app'
import { keepPreviousData, queryOptions, skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import {
  atomWithForm,
  createFormAtoms,
} from 'jotai-tanstack-form'
import {
  atomWithInfiniteQuery,
  atomWithMutation,
  atomWithQuery,
  queryClientAtom,
} from 'jotai-tanstack-query'
import * as z from 'zod'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { encodeDslContent, isWorkflowDsl } from '../../shared/domain/dsl'
import { isDeploymentDslImportEnabled } from '../../shared/domain/feature-flags'

export type ReleaseSourceMode = 'sourceApp' | 'dsl'

export type SourceAppPickerValue = Pick<App, 'id' | 'name'> & Partial<Pick<App, 'icon_type' | 'icon' | 'icon_background' | 'icon_url' | 'mode'>>

export type CreateReleaseFormValues = {
  releaseSourceMode: ReleaseSourceMode
  sourceApp?: SourceAppPickerValue
  dslFile?: File
  releaseName: string
  releaseDescription: string
}

const DEFAULT_CREATE_RELEASE_FORM_VALUES: CreateReleaseFormValues = {
  releaseSourceMode: 'sourceApp',
  sourceApp: undefined,
  dslFile: undefined,
  releaseName: '',
  releaseDescription: '',
}

export const RELEASE_NAME_REQUIRED_ERROR = 'releaseNameRequired'

const DEFAULT_SOURCE_RELEASE_PAGE_SIZE = 1
const CREATE_RELEASE_SOURCE_APP_PAGE_SIZE = 20

function deploymentReleaseSourceMode(mode: ReleaseSourceMode): ReleaseSourceMode {
  return mode === 'dsl' && !isDeploymentDslImportEnabled
    ? 'sourceApp'
    : mode
}

function workflowSourceAppPickerValue(value: unknown, fallbackId: string): SourceAppPickerValue | undefined {
  if (!value || typeof value !== 'object')
    return undefined

  const record = value as Record<string, unknown>
  const mode = typeof record.mode === 'string' ? record.mode : undefined
  if (mode !== AppModeEnum.WORKFLOW)
    return undefined

  const id = typeof record.id === 'string' && record.id ? record.id : fallbackId
  const name = typeof record.name === 'string' && record.name ? record.name : id

  return {
    id,
    name,
    mode,
  }
}

const createReleaseFormSchema = z.object({
  releaseSourceMode: z.union([z.literal('sourceApp'), z.literal('dsl')]),
  sourceApp: z.custom<CreateReleaseFormValues['sourceApp']>().optional(),
  dslFile: z.custom<CreateReleaseFormValues['dslFile']>().optional(),
  releaseName: z.string().trim().min(1, RELEASE_NAME_REQUIRED_ERROR),
  releaseDescription: z.string(),
})

type CreateReleaseSubmit = (value: CreateReleaseFormValues) => Promise<CreateReleaseResponse | undefined> | CreateReleaseResponse | undefined

type CreateReleaseSubmitMeta = {
  createRelease: CreateReleaseSubmit
}

const noopCreateRelease: CreateReleaseSubmit = () => undefined

// Form state
export const createReleaseFormAtom = atomWithForm({
  defaultValues: DEFAULT_CREATE_RELEASE_FORM_VALUES,
  onSubmitMeta: {
    createRelease: noopCreateRelease,
  },
  validators: {
    onSubmit: createReleaseFormSchema,
  },
  onSubmit: ({ value, meta }) => meta.createRelease(value),
})

const createReleaseFormAtoms = createFormAtoms(createReleaseFormAtom)

export const createReleaseFormValuesAtom = createReleaseFormAtoms.valuesAtom
export const createReleaseFormIsSubmittingAtom = createReleaseFormAtoms.isSubmittingAtom
export const createReleaseSourceModeFieldAtom = createReleaseFormAtoms.fieldAtom('releaseSourceMode')
export const createReleaseSourceAppFieldAtom = createReleaseFormAtoms.fieldAtom('sourceApp')
export const createReleaseDslFileFieldAtom = createReleaseFormAtoms.fieldAtom('dslFile')
export const createReleaseNameFieldAtom = createReleaseFormAtoms.fieldAtom('releaseName')
export const createReleaseDescriptionFieldAtom = createReleaseFormAtoms.fieldAtom('releaseDescription')

// Dialog and source primitives
export const createReleaseAppInstanceIdAtom = atom<string | undefined>(undefined)
export const createReleaseDialogOpenAtom = atom(false)
const createReleaseDslFileReadVersionAtom = atom(0)

function requiredAppInstanceId(get: Getter) {
  const appInstanceId = get(createReleaseAppInstanceIdAtom)
  if (!appInstanceId)
    throw new Error('Missing create release app instance id.')

  return appInstanceId
}

// Query and remote data
const latestSourceReleaseQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(createReleaseAppInstanceIdAtom)

  return consoleQuery.enterprise.releaseService.listReleases.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
          query: {
            pageNumber: 1,
            resultsPerPage: DEFAULT_SOURCE_RELEASE_PAGE_SIZE,
          },
        }
      : skipToken,
    enabled: Boolean(appInstanceId && get(createReleaseDialogOpenAtom)),
  })
})

function latestReleaseSourceAppId(get: Getter) {
  const latestReleaseQuery = get(latestSourceReleaseQueryAtom)

  return latestReleaseQuery.data?.releases[0]?.sourceAppId
}

const defaultSourceAppQueryAtom = atomWithQuery((get) => {
  const latestSourceAppId = latestReleaseSourceAppId(get)

  return consoleQuery.apps.byAppId.get.queryOptions({
    input: latestSourceAppId
      ? {
          params: { app_id: latestSourceAppId },
        }
      : skipToken,
    enabled: Boolean(get(createReleaseDialogOpenAtom) && latestSourceAppId),
  })
})

function defaultSourceApp(get: Getter) {
  const latestSourceAppId = latestReleaseSourceAppId(get)
  if (!latestSourceAppId)
    return undefined

  return workflowSourceAppPickerValue(get(defaultSourceAppQueryAtom).data, latestSourceAppId)
}

function submittedReleaseName(get: Getter) {
  return get(createReleaseNameFieldAtom).value.trim()
}

function cachedReleaseDisplayNames(get: Getter) {
  const appInstanceId = get(createReleaseAppInstanceIdAtom)
  if (!appInstanceId)
    return []

  const queryClient = get(queryClientAtom)
  const releaseSummaryQueries = queryClient.getQueriesData<ListReleaseSummariesResponse>({
    queryKey: consoleQuery.enterprise.releaseService.listReleaseSummaries.key({
      type: 'query',
      input: { params: { appInstanceId } },
    }),
  })
  const releaseQueries = queryClient.getQueriesData<ListReleasesResponse>({
    queryKey: consoleQuery.enterprise.releaseService.listReleases.key({
      type: 'query',
      input: { params: { appInstanceId } },
    }),
  })

  return [
    ...releaseSummaryQueries.flatMap(([, data]) => {
      return data?.releaseSummaries.map(summary => summary.release.displayName) ?? []
    }),
    ...releaseQueries.flatMap(([, data]) => {
      return data?.releases.map(release => release.displayName) ?? []
    }),
  ]
}

export const createReleaseHasNameConflictAtom = atom((get) => {
  const releaseName = submittedReleaseName(get)
  if (!releaseName)
    return false

  return cachedReleaseDisplayNames(get).some(displayName => displayName.trim() === releaseName)
})

const createReleaseDslFileContentQueryAtom = atomWithQuery((get) => {
  const file = get(createReleaseDslFileFieldAtom).value
  const fileReadVersion = get(createReleaseDslFileReadVersionAtom)

  return queryOptions({
    queryKey: [
      'createReleaseDslFileContent',
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

// Source derived state
function effectiveCreateReleaseSourceMode(get: Getter) {
  return deploymentReleaseSourceMode(get(createReleaseSourceModeFieldAtom).value)
}

export const createReleaseSourceModeAtom = atom((get) => {
  return effectiveCreateReleaseSourceMode(get)
})

export const createReleaseSourceAppSearchTextAtom = atom('')

export const createReleaseSourceAppsQueryAtom = atomWithInfiniteQuery((get) => {
  const searchText = get(createReleaseSourceAppSearchTextAtom)

  return consoleQuery.apps.list.infiniteOptions({
    input: pageParam => ({
      query: {
        page: Number(pageParam),
        limit: CREATE_RELEASE_SOURCE_APP_PAGE_SIZE,
        name: searchText,
        mode: AppModeEnum.WORKFLOW,
      },
    }),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    enabled: Boolean(
      get(createReleaseDialogOpenAtom)
      && effectiveCreateReleaseSourceMode(get) === 'sourceApp'
      && isDeploymentDslImportEnabled,
    ),
  })
})

export const createReleaseDslContentAtom = atom((get) => {
  return get(createReleaseDslFileContentQueryAtom).data ?? ''
})

export const createReleaseDslReadErrorAtom = atom((get) => {
  return Boolean(get(createReleaseDslFileFieldAtom).value && get(createReleaseDslFileContentQueryAtom).isError)
})

export const isReadingCreateReleaseDslAtom = atom((get) => {
  const file = get(createReleaseDslFileFieldAtom).value
  const dslFileContentQuery = get(createReleaseDslFileContentQueryAtom)

  return Boolean(file && (dslFileContentQuery.isLoading || dslFileContentQuery.isFetching))
})

export const createReleaseHasDslContentAtom = atom((get) => {
  return Boolean(get(createReleaseDslContentAtom).trim())
})

export const createReleaseIsWorkflowDslContentAtom = atom((get) => {
  const dslContent = get(createReleaseDslContentAtom)

  return get(createReleaseHasDslContentAtom) ? isWorkflowDsl(dslContent) : false
})

export const createReleaseEncodedDslContentAtom = atom((get) => {
  const dslContent = get(createReleaseDslContentAtom)

  return get(createReleaseHasDslContentAtom) && get(createReleaseIsWorkflowDslContentAtom)
    ? encodeDslContent(dslContent)
    : ''
})

export const createReleaseSelectedSourceAppAtom = atom((get) => {
  if (effectiveCreateReleaseSourceMode(get) !== 'sourceApp')
    return undefined

  const fieldSourceApp = get(createReleaseSourceAppFieldAtom).value
  const fallbackSourceApp = defaultSourceApp(get)

  if (!isDeploymentDslImportEnabled)
    return fallbackSourceApp

  return fieldSourceApp ?? fallbackSourceApp
})

function selectedSourceAppId(get: Getter) {
  return effectiveCreateReleaseSourceMode(get) === 'sourceApp'
    ? get(createReleaseSelectedSourceAppAtom)?.id
    : undefined
}

function hasUnsupportedDslMode(get: Getter) {
  if (effectiveCreateReleaseSourceMode(get) !== 'dsl')
    return false

  return get(createReleaseHasDslContentAtom)
    && !get(isReadingCreateReleaseDslAtom)
    && !get(createReleaseDslReadErrorAtom)
    && !get(createReleaseIsWorkflowDslContentAtom)
}

export const createReleaseHasUnsupportedDslModeAtom = atom((get) => {
  return hasUnsupportedDslMode(get)
})

function canCheckReleaseSourceContent(get: Getter) {
  if (effectiveCreateReleaseSourceMode(get) === 'sourceApp')
    return Boolean(selectedSourceAppId(get))
  if (!isDeploymentDslImportEnabled)
    return false

  return Boolean(
    get(createReleaseHasDslContentAtom)
    && !get(isReadingCreateReleaseDslAtom)
    && !get(createReleaseDslReadErrorAtom)
    && !hasUnsupportedDslMode(get),
  )
}

function canCheckReleaseContent(get: Getter) {
  return Boolean(
    get(createReleaseAppInstanceIdAtom)
    && get(createReleaseDialogOpenAtom)
    && canCheckReleaseSourceContent(get),
  )
}

// Release content check
const precheckReleaseQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(createReleaseAppInstanceIdAtom)
  const releaseSourceMode = effectiveCreateReleaseSourceMode(get)
  const sourceAppId = selectedSourceAppId(get)
  const canCheck = canCheckReleaseContent(get)

  return consoleQuery.enterprise.releaseService.precheckRelease.queryOptions({
    input: appInstanceId
      ? releaseSourceMode === 'dsl'
        ? {
            body: {
              appInstanceId,
              dsl: get(createReleaseEncodedDslContentAtom),
            },
          }
        : sourceAppId
          ? {
              body: {
                appInstanceId,
                sourceAppId,
              },
            }
          : skipToken
      : skipToken,
    enabled: canCheck,
    retry: false,
  })
})

export const isCheckingCreateReleaseContentAtom = atom((get) => {
  const canCheck = canCheckReleaseContent(get)
  const precheckReleaseQuery = get(precheckReleaseQueryAtom)

  return canCheck && (precheckReleaseQuery.isLoading || precheckReleaseQuery.isFetching)
})

export const createReleaseMatchedReleaseAtom = atom((get) => {
  return canCheckReleaseContent(get)
    ? get(precheckReleaseQueryAtom).data?.matchedRelease
    : undefined
})

export const createReleaseContentCheckFailedAtom = atom((get) => {
  return canCheckReleaseContent(get) && get(precheckReleaseQueryAtom).isError
})

export const createReleaseUnsupportedDslNodesAtom = atom((get): UnsupportedDslNode[] => {
  return canCheckReleaseContent(get)
    ? get(precheckReleaseQueryAtom).data?.unsupportedNodes ?? []
    : []
})

export const createReleaseContentReadyAtom = atom((get) => {
  const canCheck = canCheckReleaseContent(get)
  const precheckReleaseQuery = get(precheckReleaseQueryAtom)

  return canCheck
    && precheckReleaseQuery.isSuccess
    && !get(isCheckingCreateReleaseContentAtom)
    && !get(createReleaseContentCheckFailedAtom)
    && Boolean(precheckReleaseQuery.data?.canCreate)
    && get(createReleaseUnsupportedDslNodesAtom).length === 0
})

// Actions
const resetCreateReleaseDslFileAtom = atom(null, (get, set) => {
  set(createReleaseDslFileFieldAtom, undefined)
  set(createReleaseDslFileReadVersionAtom, get(createReleaseDslFileReadVersionAtom) + 1)
})

export const openCreateReleaseDialogAtom = atom(null, (_get, set) => {
  set(resetCreateReleaseDslFileAtom)
  set(createReleaseDialogOpenAtom, true)
})

export const closeCreateReleaseDialogAtom = atom(null, (_get, set) => {
  set(createReleaseDialogOpenAtom, false)
  set(resetCreateReleaseDslFileAtom)
})

export const requestCloseCreateReleaseDialogAtom = atom(null, (get, set) => {
  if (get(createReleaseFormIsSubmittingAtom))
    return

  set(closeCreateReleaseDialogAtom)
})

export const selectCreateReleaseSourceModeAtom = atom(null, (_get, set, releaseSourceMode: ReleaseSourceMode) => {
  const effectiveReleaseSourceMode = deploymentReleaseSourceMode(releaseSourceMode)
  set(createReleaseSourceModeFieldAtom, effectiveReleaseSourceMode)

  if (effectiveReleaseSourceMode === 'sourceApp') {
    set(resetCreateReleaseDslFileAtom)
    return
  }

  set(createReleaseSourceAppFieldAtom, undefined)
})

export const updateCreateReleaseSourceAppAtom = atom(null, (_get, set, sourceApp: CreateReleaseFormValues['sourceApp']) => {
  set(createReleaseSourceAppFieldAtom, sourceApp)
})

export const updateCreateReleaseDslFileAtom = atom(null, (get, set, dslFile: CreateReleaseFormValues['dslFile']) => {
  set(createReleaseDslFileFieldAtom, dslFile)
  set(createReleaseDslFileReadVersionAtom, get(createReleaseDslFileReadVersionAtom) + 1)
})

// Submission
const createReleaseMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.releaseService.createRelease.mutationOptions(),
)

export const isCreatingReleaseAtom = atom((get) => {
  return get(createReleaseMutationAtom).isPending
})

export class CreateReleaseSubmissionBlockedError extends Error {
  reason: 'unsupportedDslMode'

  constructor(reason: 'unsupportedDslMode') {
    super(reason)
    this.reason = reason
    this.name = 'CreateReleaseSubmissionBlockedError'
  }
}

const createReleaseSubmissionAtom = atom(null, async (get, set, value: CreateReleaseFormValues) => {
  const releaseSourceMode = effectiveCreateReleaseSourceMode(get)
  const sourceAppId = selectedSourceAppId(get)
  const submittedReleaseName = value.releaseName.trim()

  if (get(isCheckingCreateReleaseContentAtom) || !submittedReleaseName)
    return undefined

  if (get(createReleaseHasNameConflictAtom))
    return undefined

  if (!canCheckReleaseSourceContent(get) || !get(createReleaseContentReadyAtom))
    return undefined

  const appInstanceId = requiredAppInstanceId(get)
  const commonCreateReleaseRequest = {
    appInstanceId,
    displayName: submittedReleaseName,
    description: value.releaseDescription.trim() || undefined,
    createAppInstance: false,
  }

  if (releaseSourceMode === 'dsl') {
    if (!get(createReleaseIsWorkflowDslContentAtom))
      throw new CreateReleaseSubmissionBlockedError('unsupportedDslMode')

    return await get(createReleaseMutationAtom).mutateAsync({
      body: {
        ...commonCreateReleaseRequest,
        dsl: get(createReleaseEncodedDslContentAtom),
      },
    })
  }

  if (!sourceAppId)
    return undefined

  return await get(createReleaseMutationAtom).mutateAsync({
    body: {
      ...commonCreateReleaseRequest,
      sourceAppId,
    },
  })
})

export const submitCreateReleaseFormAtom = atom(null, (get, set) => {
  const form = get(createReleaseFormAtom)
  let submitResponse: CreateReleaseResponse | undefined

  return form.api.handleSubmit({
    createRelease: async (value) => {
      const response = await set(createReleaseSubmissionAtom, value)
      submitResponse = response

      return response
    },
  } satisfies CreateReleaseSubmitMeta)
    .then(() => submitResponse)
})

// Scoped atoms
export const createReleaseLocalAtoms = [
  createReleaseDialogOpenAtom,
  createReleaseDslFileReadVersionAtom,
  createReleaseSourceAppSearchTextAtom,
] as const

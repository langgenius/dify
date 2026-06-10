'use client'

import type { CreateReleaseDslState } from './atoms'
import type { CreateReleaseFormValues, ReleaseSourceMode } from './types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { consoleQuery } from '@/service/client'
import {
  createReleaseDialogOpenAtom,
  createReleaseDslStateAtom,
  useCreateReleaseConfig,
} from './atoms'

export type CreateReleaseSourceSelection = CreateReleaseDslState & {
  hasUnsupportedDslMode: boolean
  releaseSourceMode: ReleaseSourceMode
  selectedSourceAppId?: string
}

export function createReleaseSourceSelection(
  formValues: CreateReleaseFormValues,
  dslState: CreateReleaseDslState,
): CreateReleaseSourceSelection {
  const hasUnsupportedDslMode = formValues.releaseSourceMode === 'dsl'
    && dslState.hasDslContent
    && !dslState.isReadingDsl
    && !dslState.dslReadError
    && !dslState.isWorkflowDslContent
  const selectedSourceAppId = formValues.releaseSourceMode === 'sourceApp' ? formValues.sourceApp?.id : undefined

  return {
    ...dslState,
    hasUnsupportedDslMode,
    releaseSourceMode: formValues.releaseSourceMode,
    selectedSourceAppId,
  }
}

export function canCheckReleaseSourceContent(releaseSource: CreateReleaseSourceSelection) {
  if (releaseSource.releaseSourceMode === 'sourceApp')
    return Boolean(releaseSource.selectedSourceAppId)

  return Boolean(
    releaseSource.hasDslContent
    && !releaseSource.isReadingDsl
    && !releaseSource.dslReadError
    && !releaseSource.hasUnsupportedDslMode,
  )
}

export function useReleaseContentCheck(releaseSource: CreateReleaseSourceSelection) {
  const { appInstanceId } = useCreateReleaseConfig()
  const isDialogOpen = useAtomValue(createReleaseDialogOpenAtom)
  const canCheckReleaseContent = isDialogOpen && canCheckReleaseSourceContent(releaseSource)
  const sourceAppReleaseContentInput = canCheckReleaseContent && releaseSource.releaseSourceMode === 'sourceApp' && releaseSource.selectedSourceAppId
    ? {
        body: {
          appInstanceId,
          sourceAppId: releaseSource.selectedSourceAppId,
        },
      }
    : undefined
  const dslReleaseContentInput = canCheckReleaseContent && releaseSource.releaseSourceMode === 'dsl'
    ? {
        body: {
          appInstanceId,
          dsl: releaseSource.encodedDslContent,
        },
      }
    : undefined
  const sourceAppReleaseContentQuery = useQuery({
    ...(sourceAppReleaseContentInput
      ? consoleQuery.enterprise.releaseService.checkReleaseContentFromSourceApp.queryOptions({
          input: sourceAppReleaseContentInput,
        })
      : {
          queryFn: skipToken,
          queryKey: ['create-release', 'release-content', 'source-app'],
        }),
    retry: false,
  })
  const dslReleaseContentQuery = useQuery({
    ...(dslReleaseContentInput
      ? consoleQuery.enterprise.releaseService.checkReleaseContentFromDsl.queryOptions({
          input: dslReleaseContentInput,
        })
      : {
          queryFn: skipToken,
          queryKey: ['create-release', 'release-content', 'dsl'],
        }),
    retry: false,
  })
  const activeReleaseContentQuery = releaseSource.releaseSourceMode === 'dsl' ? dslReleaseContentQuery : sourceAppReleaseContentQuery
  const matchedRelease = canCheckReleaseContent ? activeReleaseContentQuery.data?.matchedRelease : undefined
  const isCheckingReleaseContent = canCheckReleaseContent && (activeReleaseContentQuery.isLoading || activeReleaseContentQuery.isFetching)
  const releaseContentCheckFailed = canCheckReleaseContent && activeReleaseContentQuery.isError
  const releaseContentReady = canCheckReleaseContent && activeReleaseContentQuery.isSuccess && !isCheckingReleaseContent && !matchedRelease && !releaseContentCheckFailed

  return {
    isCheckingReleaseContent,
    matchedRelease,
    releaseContentCheckFailed,
    releaseContentReady,
  }
}

export type ReleaseContentCheck = ReturnType<typeof useReleaseContentCheck>

export function useCreateReleaseSourceSelection(formValues: CreateReleaseFormValues) {
  const dslState = useAtomValue(createReleaseDslStateAtom)

  return createReleaseSourceSelection(formValues, dslState)
}

export function createReleaseReadiness({
  formValues,
  isSubmitting,
  releaseContent,
}: {
  formValues: CreateReleaseFormValues
  isSubmitting: boolean
  releaseContent: ReleaseContentCheck
}) {
  const canCreate = Boolean(
    formValues.releaseName.trim()
    && releaseContent.releaseContentReady
    && !isSubmitting,
  )

  return {
    canCreate,
    isCheckingReleaseContent: releaseContent.isCheckingReleaseContent,
  }
}

'use client'

import type { CreateReleaseDslState } from '../state'
import type { CreateReleaseFormValues, ReleaseSourceMode } from '../state/types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { consoleQuery } from '@/service/client'
import { isDeploymentDslImportEnabled } from '../../shared/domain/feature-flags'
import {
  createReleaseDialogOpenAtom,
  createReleaseDslStateAtom,
  useCreateReleaseConfig,
} from '../state'

export type CreateReleaseSourceSelection = CreateReleaseDslState & {
  hasUnsupportedDslMode: boolean
  releaseSourceMode: ReleaseSourceMode
  selectedSourceAppId?: string
}

function createReleaseSourceSelection(
  formValues: CreateReleaseFormValues,
  dslState: CreateReleaseDslState,
): CreateReleaseSourceSelection {
  const releaseSourceMode = formValues.releaseSourceMode === 'dsl' && !isDeploymentDslImportEnabled
    ? 'sourceApp'
    : formValues.releaseSourceMode
  const hasUnsupportedDslMode = releaseSourceMode === 'dsl'
    && dslState.hasDslContent
    && !dslState.isReadingDsl
    && !dslState.dslReadError
    && !dslState.isWorkflowDslContent
  const selectedSourceAppId = releaseSourceMode === 'sourceApp' ? formValues.sourceApp?.id : undefined

  return {
    ...dslState,
    hasUnsupportedDslMode,
    releaseSourceMode,
    selectedSourceAppId,
  }
}

export function canCheckReleaseSourceContent(releaseSource: CreateReleaseSourceSelection) {
  if (releaseSource.releaseSourceMode === 'sourceApp')
    return Boolean(releaseSource.selectedSourceAppId)
  if (!isDeploymentDslImportEnabled)
    return false

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
  // PrecheckRelease takes exactly one source arm (dsl | sourceAppId).
  const precheckSource = releaseSource.releaseSourceMode === 'sourceApp'
    ? (releaseSource.selectedSourceAppId ? { sourceAppId: releaseSource.selectedSourceAppId } : undefined)
    : { dsl: releaseSource.encodedDslContent }
  const precheckInput = canCheckReleaseContent && precheckSource
    ? {
        body: {
          appInstanceId,
          ...precheckSource,
        },
      }
    : undefined
  const precheckQuery = useQuery({
    ...(precheckInput
      ? consoleQuery.enterprise.releaseService.precheckRelease.queryOptions({
          input: precheckInput,
        })
      : {
          queryFn: skipToken,
          queryKey: ['create-release', 'release-precheck'],
        }),
    retry: false,
  })
  const matchedRelease = canCheckReleaseContent ? precheckQuery.data?.matchedRelease : undefined
  const unsupportedNodes = (canCheckReleaseContent ? precheckQuery.data?.unsupportedNodes : undefined) ?? []
  const isCheckingReleaseContent = canCheckReleaseContent && (precheckQuery.isLoading || precheckQuery.isFetching)
  const releaseContentCheckFailed = canCheckReleaseContent && precheckQuery.isError
  const releaseContentReady = canCheckReleaseContent
    && precheckQuery.isSuccess
    && !isCheckingReleaseContent
    && !releaseContentCheckFailed
    && Boolean(precheckQuery.data?.canCreate)

  return {
    isCheckingReleaseContent,
    matchedRelease,
    releaseContentCheckFailed,
    releaseContentReady,
    unsupportedNodes,
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

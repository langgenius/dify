'use client'

import type { CreateReleaseResponse } from '@dify/contracts/enterprise/types.gen'
import type { CreateReleaseFormValues } from '../state/types'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { deploymentErrorMessage, unsupportedDslNodeError } from '../../shared/domain/error'
import {
  clearCreateReleaseSubmissionErrorAtom,
  closeCreateReleaseDialogAtom,
  createReleaseSubmitUnsupportedDslNodesAtom,
  useCreateReleaseConfig,
} from '../state'
import {
  canCheckReleaseSourceContent,
  useCreateReleaseSourceSelection,
  useReleaseContentCheck,
} from './use-release-content-check'

export function useCreateReleaseSubmission(formValues: CreateReleaseFormValues) {
  const { t } = useTranslation('deployments')
  const { appInstanceId } = useCreateReleaseConfig()
  const sourceSelection = useCreateReleaseSourceSelection(formValues)
  const releaseContent = useReleaseContentCheck(sourceSelection)
  const closeDialog = useSetAtom(closeCreateReleaseDialogAtom)
  const createReleaseMutation = useMutation(consoleQuery.enterprise.releaseService.createRelease.mutationOptions())
  const clearSubmitError = useSetAtom(clearCreateReleaseSubmissionErrorAtom)
  const setUnsupportedDslNodes = useSetAtom(createReleaseSubmitUnsupportedDslNodesAtom)

  function clearSubmissionError() {
    createReleaseMutation.reset()
    clearSubmitError()
  }

  function handleSuccess(response: CreateReleaseResponse) {
    const createdName = response.release.displayName
    toast.success(t('versions.createSuccess', { name: createdName }))
    closeDialog()
  }

  async function handleError(error: unknown) {
    const unsupportedError = await unsupportedDslNodeError(error)
    if (unsupportedError?.nodes.length) {
      setUnsupportedDslNodes(unsupportedError.nodes)
      return
    }

    const message = await deploymentErrorMessage(error)
    toast.error(message || t('versions.createFailed'))
  }

  async function createRelease(value: CreateReleaseFormValues) {
    if (releaseContent.isCheckingReleaseContent)
      return

    const submittedReleaseName = value.releaseName.trim()
    if (!submittedReleaseName)
      return

    clearSubmissionError()
    try {
      if (!canCheckReleaseSourceContent(sourceSelection) || !releaseContent.releaseContentReady)
        return

      if (sourceSelection.releaseSourceMode === 'dsl') {
        if (!sourceSelection.isWorkflowDslContent) {
          toast.error(t('versions.dslUnsupportedMode'))
          return
        }

        const response = await createReleaseMutation.mutateAsync({
          body: {
            appInstanceId,
            dsl: sourceSelection.encodedDslContent,
            displayName: submittedReleaseName,
            description: value.releaseDescription.trim() || undefined,
            createAppInstance: false,
          },
        })
        handleSuccess(response)
        return
      }

      if (!sourceSelection.selectedSourceAppId)
        return

      const response = await createReleaseMutation.mutateAsync({
        body: {
          appInstanceId,
          sourceAppId: sourceSelection.selectedSourceAppId,
          displayName: submittedReleaseName,
          description: value.releaseDescription.trim() || undefined,
          createAppInstance: false,
        },
      })
      handleSuccess(response)
    }
    catch (error) {
      await handleError(error)
    }
  }

  return {
    createRelease,
  }
}

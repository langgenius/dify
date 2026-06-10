'use client'

import type { CreateReleaseReply } from '@dify/contracts/enterprise/types.gen'
import type { CreateReleaseFormValues } from './types'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { deploymentErrorMessage, unsupportedDslNodeError } from '../../error'
import {
  clearCreateReleaseSubmissionErrorAtom,
  closeCreateReleaseDialogAtom,
  createReleaseSubmitUnsupportedDslNodesAtom,
  useCreateReleaseConfig,
} from './atoms'
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
  const createReleaseFromSourceApp = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions())
  const createReleaseFromDsl = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions())
  const clearSubmitError = useSetAtom(clearCreateReleaseSubmissionErrorAtom)
  const setUnsupportedDslNodes = useSetAtom(createReleaseSubmitUnsupportedDslNodesAtom)

  function clearSubmissionError() {
    createReleaseFromSourceApp.reset()
    createReleaseFromDsl.reset()
    clearSubmitError()
  }

  function handleSuccess(response: CreateReleaseReply) {
    const createdName = response.release.name
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

      if (value.releaseSourceMode === 'dsl') {
        if (!sourceSelection.isWorkflowDslContent) {
          toast.error(t('versions.dslUnsupportedMode'))
          return
        }

        const response = await createReleaseFromDsl.mutateAsync({
          body: {
            appInstanceId,
            dsl: sourceSelection.encodedDslContent,
            name: submittedReleaseName,
            description: value.releaseDescription.trim() || undefined,
            createAppInstance: false,
          },
        })
        handleSuccess(response)
        return
      }

      if (!sourceSelection.selectedSourceAppId)
        return

      const response = await createReleaseFromSourceApp.mutateAsync({
        body: {
          appInstanceId,
          sourceAppId: sourceSelection.selectedSourceAppId,
          name: submittedReleaseName,
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

'use client'

import type { WorkflowSourceApp } from '../types'
import type { CreateDeploymentSubmissionDraft } from './draft'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { isCreatingReleaseOnlyAtom } from '../state/submission-atoms'

export function useCreateReleaseOnlySubmission({
  effectiveSelectedApp,
  submissionDraft,
}: {
  effectiveSelectedApp?: WorkflowSourceApp
  submissionDraft: CreateDeploymentSubmissionDraft
}) {
  const router = useRouter()
  const createAppInstance = useMutation(consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions())
  const createReleaseFromDsl = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions())
  const createReleaseFromSourceApp = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions())
  const isSkippingReleaseOnly = useAtomValue(isCreatingReleaseOnlyAtom)
  const setIsSkippingReleaseOnly = useSetAtom(isCreatingReleaseOnlyAtom)

  async function createInitialReleaseOnly() {
    setIsSkippingReleaseOnly(true)

    try {
      const createdAppInstance = await createAppInstance.mutateAsync({
        body: {
          name: submissionDraft.submittedInstanceName,
          description: submissionDraft.instanceDescription.trim() || undefined,
        },
      })
      const appInstanceId = createdAppInstance.appInstance.id

      if (submissionDraft.method === 'importDsl') {
        await createReleaseFromDsl.mutateAsync({
          body: {
            appInstanceId,
            dsl: submissionDraft.dslState.encodedDslContent,
            name: submissionDraft.submittedReleaseName,
            description: submissionDraft.submittedReleaseDescription || undefined,
            createAppInstance: false,
          },
        })
      }
      else if (effectiveSelectedApp?.id) {
        await createReleaseFromSourceApp.mutateAsync({
          body: {
            appInstanceId,
            sourceAppId: effectiveSelectedApp.id,
            name: submissionDraft.submittedReleaseName,
            description: submissionDraft.submittedReleaseDescription || undefined,
            createAppInstance: false,
          },
        })
      }
      else {
        return
      }

      router.push(`/deployments/${appInstanceId}/overview`)
    }
    finally {
      setIsSkippingReleaseOnly(false)
    }
  }

  return {
    createInitialReleaseOnly,
    isSkippingReleaseOnly,
  }
}

'use client'

import type { CreateDeploymentSubmissionDraft } from './draft'
import type { App } from '@/types/app'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'

export function useCreateReleaseOnlySubmission({
  effectiveSelectedApp,
  submissionDraft,
}: {
  effectiveSelectedApp?: App
  submissionDraft: CreateDeploymentSubmissionDraft
}) {
  const router = useRouter()
  const createAppInstance = useMutation(consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions())
  const createReleaseFromDsl = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions())
  const createReleaseFromSourceApp = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions())
  const [isSkippingReleaseOnly, setIsSkippingReleaseOnly] = useState(false)

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

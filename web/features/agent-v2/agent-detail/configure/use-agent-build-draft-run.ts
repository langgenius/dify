'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/client'

export type AgentConfigureSoulSource = 'draft' | 'build-draft' | 'view-version'

export function usePrepareAgentBuildDraftBeforeRun({
  agentId,
  isBuildDraftActive,
  saveDraft,
  setSoulSourceOverride,
}: {
  agentId?: string
  isBuildDraftActive: boolean
  saveDraft: () => Promise<unknown>
  setSoulSourceOverride?: (source: AgentConfigureSoulSource) => void
}) {
  const queryClient = useQueryClient()
  const buildDraftQueryOptions = consoleQuery.agent.byAgentId.buildDraft.get.queryOptions({
    input: {
      params: {
        agent_id: agentId ?? '',
      },
    },
  })
  const checkoutBuildDraftMutation = useMutation(consoleQuery.agent.byAgentId.buildDraft.checkout.post.mutationOptions())
  const { mutateAsync: checkoutBuildDraft, isPending: isCheckingOutBuildDraft } = checkoutBuildDraftMutation

  const prepareBuildDraftBeforeRun = useCallback(async () => {
    if (!agentId)
      return

    if (!isBuildDraftActive)
      await saveDraft()

    const buildDraft = await checkoutBuildDraft({
      params: {
        agent_id: agentId,
      },
      body: {
        force: false,
      },
    })
    queryClient.setQueryData(buildDraftQueryOptions.queryKey, buildDraft)
    setSoulSourceOverride?.('build-draft')
  }, [agentId, buildDraftQueryOptions.queryKey, checkoutBuildDraft, isBuildDraftActive, queryClient, saveDraft, setSoulSourceOverride])

  return {
    isCheckingOutBuildDraft,
    prepareBuildDraftBeforeRun,
  }
}

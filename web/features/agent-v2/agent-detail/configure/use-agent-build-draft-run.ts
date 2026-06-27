'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigureSoulSource } from './state'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/client'

export function usePrepareAgentBuildDraftBeforeRun({
  agentId,
  isBuildDraftActive,
  rebaseComposerDraft,
  saveDraft,
  setSoulSourceOverride,
}: {
  agentId?: string
  isBuildDraftActive: boolean
  rebaseComposerDraft?: (agentSoulConfig?: AgentSoulConfig) => void
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
    rebaseComposerDraft?.(buildDraft.agent_soul as AgentSoulConfig | undefined)
    setSoulSourceOverride?.('build-draft')
  }, [agentId, buildDraftQueryOptions.queryKey, checkoutBuildDraft, isBuildDraftActive, queryClient, rebaseComposerDraft, saveDraft, setSoulSourceOverride])

  return {
    isCheckingOutBuildDraft,
    prepareBuildDraftBeforeRun,
  }
}

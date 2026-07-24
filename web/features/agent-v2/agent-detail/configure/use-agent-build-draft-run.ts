'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigureSoulSource } from './state'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/client'

export function usePrepareAgentBuildDraftBeforeRun({
  agentId,
  buildDraftAgentSoulConfig,
  isBuildDraftActive,
  rebaseComposerDraft,
  saveDraft,
  setSoulSourceOverride,
}: {
  agentId?: string
  buildDraftAgentSoulConfig?: AgentSoulConfig
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
  const checkoutBuildDraftMutation = useMutation(
    consoleQuery.agent.byAgentId.buildDraft.checkout.post.mutationOptions(),
  )
  const { mutateAsync: checkoutBuildDraft, isPending: isCheckingOutBuildDraft } =
    checkoutBuildDraftMutation

  const checkoutBuildDraftFromNormalDraft = useCallback(
    async (force: boolean) => {
      if (!agentId) return

      const buildDraft = await checkoutBuildDraft({
        params: {
          agent_id: agentId,
        },
        body: {
          force,
        },
      })
      queryClient.setQueryData(buildDraftQueryOptions.queryKey, buildDraft)
      rebaseComposerDraft?.(buildDraft.agent_soul as AgentSoulConfig | undefined)
      setSoulSourceOverride?.('build-draft')
      return buildDraft.agent_soul as AgentSoulConfig | undefined
    },
    [
      agentId,
      buildDraftQueryOptions.queryKey,
      checkoutBuildDraft,
      queryClient,
      rebaseComposerDraft,
      setSoulSourceOverride,
    ],
  )

  const prepareBuildDraftBeforeRun = useCallback(async () => {
    if (!agentId) return

    await saveDraft()

    if (isBuildDraftActive) return buildDraftAgentSoulConfig

    return checkoutBuildDraftFromNormalDraft(false)
  }, [
    agentId,
    buildDraftAgentSoulConfig,
    checkoutBuildDraftFromNormalDraft,
    isBuildDraftActive,
    saveDraft,
  ])
  const forceCheckoutBuildDraft = useCallback(
    () => checkoutBuildDraftFromNormalDraft(true),
    [checkoutBuildDraftFromNormalDraft],
  )

  return {
    forceCheckoutBuildDraft,
    isCheckingOutBuildDraft,
    prepareBuildDraftBeforeRun,
  }
}

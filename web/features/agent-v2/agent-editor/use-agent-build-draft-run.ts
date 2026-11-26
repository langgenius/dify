'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigureSoulSource } from './state'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

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
  const { t } = useTranslation(['common'])
  const checkoutBuildDraftMutation = useMutation(
    consoleQuery.agent.byAgentId.buildDraft.checkout.post.mutationOptions({
      meta: { errorToast: false },
    }),
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
      }).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t(($) => $['api.actionFailed']))
        throw error
      })
      rebaseComposerDraft?.(buildDraft.agent_soul as AgentSoulConfig | undefined)
      setSoulSourceOverride?.('build-draft')
      return buildDraft.agent_soul as AgentSoulConfig | undefined
    },
    [agentId, checkoutBuildDraft, rebaseComposerDraft, setSoulSourceOverride, t],
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

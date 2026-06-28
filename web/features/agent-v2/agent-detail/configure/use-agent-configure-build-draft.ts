'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigureSoulSource } from './state'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { consoleQuery } from '@/service/client'
import { agentConfigureConsoleQuery } from './build-draft-query'
import { usePrepareAgentBuildDraftBeforeRun } from './use-agent-build-draft-run'

const isNotFoundResponse = (error: unknown) => error instanceof Response && error.status === 404
const getAgentSoulConfigFromRefetchResult = (result: unknown) => {
  return (result as { data?: { agent_soul?: AgentSoulConfig } } | undefined)?.data?.agent_soul
}

export function useAgentConfigureBuildDraftData({
  agentId,
  activeVersionId,
  composerAgentSoulConfig,
  isViewingVersion,
  normalAgentSoulConfig,
  setSoulSourceOverride,
  soulSourceOverride,
}: {
  agentId: string
  activeVersionId: string | null | undefined
  composerAgentSoulConfig?: AgentSoulConfig
  isViewingVersion: boolean
  normalAgentSoulConfig?: AgentSoulConfig
  setSoulSourceOverride: (source: AgentConfigureSoulSource | null) => void
  soulSourceOverride: AgentConfigureSoulSource | null
}) {
  const shouldSilenceBuildDraftCheckRef = useRef(true)
  const buildDraftQueryInput = {
    params: {
      agent_id: agentId,
    },
  }
  const buildDraftQueryOptions = agentConfigureConsoleQuery.agent.byAgentId.buildDraft.get.queryOptions({
    input: {
      params: buildDraftQueryInput.params,
    },
    context: {},
  })
  const silentBuildDraftQueryOptions = agentConfigureConsoleQuery.agent.byAgentId.buildDraft.get.queryOptions({
    input: {
      params: buildDraftQueryInput.params,
    },
    context: {
      silent: true,
    },
    queryKey: buildDraftQueryOptions.queryKey,
  })
  const buildDraftQuery = useQuery({
    ...buildDraftQueryOptions,
    enabled: !isViewingVersion && soulSourceOverride !== 'draft' && soulSourceOverride !== 'view-version',
    queryFn: async (context) => {
      try {
        const queryOptions = shouldSilenceBuildDraftCheckRef.current
          ? silentBuildDraftQueryOptions
          : buildDraftQueryOptions

        shouldSilenceBuildDraftCheckRef.current = false
        return await queryOptions.queryFn(context)
      }
      catch (error) {
        if (isNotFoundResponse(error))
          setSoulSourceOverride('draft')
        throw error
      }
    },
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const {
    data: buildDraftData,
    dataUpdatedAt: buildDraftDataUpdatedAt,
    error: buildDraftError,
    isError: isBuildDraftError,
    isPending: isBuildDraftPending,
    refetch: refetchBuildDraft,
  } = buildDraftQuery
  const buildDraftNotFound = isNotFoundResponse(buildDraftError)
  const soulSource: AgentConfigureSoulSource = isViewingVersion
    ? 'view-version'
    : soulSourceOverride ?? (!buildDraftNotFound && !!buildDraftData && !isBuildDraftError ? 'build-draft' : 'draft')
  const isBuildDraftActive = soulSource === 'build-draft'
  const buildDraftAgentSoulConfig = buildDraftData?.agent_soul as AgentSoulConfig | undefined
  const visibleAgentSoulConfig = isBuildDraftActive ? buildDraftAgentSoulConfig : normalAgentSoulConfig
  const buildDraftChangesCount = useMemo(() => {
    if (!buildDraftAgentSoulConfig || !composerAgentSoulConfig)
      return 0

    const normalDraft = agentSoulConfigToFormState(composerAgentSoulConfig)
    const buildDraft = agentSoulConfigToFormState(buildDraftAgentSoulConfig)

    return (Object.keys(buildDraft) as Array<keyof typeof buildDraft>)
      .filter(key => JSON.stringify(buildDraft[key]) !== JSON.stringify(normalDraft[key]))
      .length
  }, [buildDraftAgentSoulConfig, composerAgentSoulConfig])

  return {
    activeVersionId: isBuildDraftActive ? `build-draft:${buildDraftDataUpdatedAt}` : activeVersionId,
    agentSoulConfig: visibleAgentSoulConfig,
    changesCount: buildDraftChangesCount,
    isActive: isBuildDraftActive,
    isPending: !isViewingVersion && soulSourceOverride !== 'draft' && soulSourceOverride !== 'view-version' && isBuildDraftPending,
    refetch: refetchBuildDraft,
    setSoulSourceOverride,
    soulSource,
  }
}

export function useAgentConfigureBuildDraftActions({
  agentId,
  isActive,
  normalAgentSoulConfig,
  rebaseComposerDraft,
  refetchBuildDraft,
  refetchComposer,
  resetBuildChatSession,
  saveDraft,
  onComposerRebased,
  setSoulSourceOverride,
}: {
  agentId: string
  isActive: boolean
  normalAgentSoulConfig?: AgentSoulConfig
  rebaseComposerDraft: (agentSoulConfig?: AgentSoulConfig) => void
  refetchBuildDraft: () => Promise<unknown>
  refetchComposer: () => Promise<unknown>
  resetBuildChatSession: () => Promise<void>
  saveDraft: () => Promise<void>
  onComposerRebased?: () => void
  setSoulSourceOverride: (source: AgentConfigureSoulSource | null) => void
}) {
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const buildDraftRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buildDraftRefreshGenerationRef = useRef(0)
  const buildDraftQueryOptions = consoleQuery.agent.byAgentId.buildDraft.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  })
  const agentDetailQueryKey = consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } })
  const applyBuildDraftMutation = useMutation(consoleQuery.agent.byAgentId.buildDraft.apply.post.mutationOptions())
  const discardBuildDraftMutation = useMutation(consoleQuery.agent.byAgentId.buildDraft.delete.mutationOptions())
  const { mutateAsync: applyBuildDraftRequest, isPending: isApplyingBuildDraft } = applyBuildDraftMutation
  const { mutateAsync: discardBuildDraftRequest, isPending: isDiscardingBuildDraft } = discardBuildDraftMutation
  const { prepareBuildDraftBeforeRun } = usePrepareAgentBuildDraftBeforeRun({
    agentId,
    isBuildDraftActive: isActive,
    rebaseComposerDraft,
    saveDraft,
    setSoulSourceOverride,
  })

  const cancelBuildDraftRefresh = useCallback(() => {
    buildDraftRefreshGenerationRef.current += 1
    if (!buildDraftRefreshTimerRef.current)
      return

    clearTimeout(buildDraftRefreshTimerRef.current)
    buildDraftRefreshTimerRef.current = null
  }, [])

  const prepareBuildDraftRun = useCallback(async () => {
    cancelBuildDraftRefresh()
    return prepareBuildDraftBeforeRun()
  }, [cancelBuildDraftRefresh, prepareBuildDraftBeforeRun])

  const refreshBuildDraftAfterBuildChat = useCallback((onRefreshed?: () => void) => {
    cancelBuildDraftRefresh()
    const refreshGeneration = buildDraftRefreshGenerationRef.current

    buildDraftRefreshTimerRef.current = setTimeout(async () => {
      buildDraftRefreshTimerRef.current = null
      try {
        const result = await refetchBuildDraft()
        if (refreshGeneration !== buildDraftRefreshGenerationRef.current)
          return

        const agentSoulConfig = getAgentSoulConfigFromRefetchResult(result)
        if (agentSoulConfig)
          rebaseComposerDraft(agentSoulConfig)
      }
      catch {}
      finally {
        if (refreshGeneration === buildDraftRefreshGenerationRef.current)
          onRefreshed?.()
      }
    }, 1000)
  }, [cancelBuildDraftRefresh, rebaseComposerDraft, refetchBuildDraft])

  const exitBuildDraftMode = useCallback(async (shouldRefetchComposer: boolean) => {
    cancelBuildDraftRefresh()
    await resetBuildChatSession().catch(() => undefined)
    setSoulSourceOverride('draft')
    queryClient.removeQueries({
      queryKey: buildDraftQueryOptions.queryKey,
    })
    if (shouldRefetchComposer) {
      const result = await refetchComposer()
      rebaseComposerDraft(getAgentSoulConfigFromRefetchResult(result) ?? normalAgentSoulConfig)
      onComposerRebased?.()
    }
    else {
      rebaseComposerDraft(normalAgentSoulConfig)
    }
  }, [buildDraftQueryOptions.queryKey, cancelBuildDraftRefresh, normalAgentSoulConfig, onComposerRebased, queryClient, rebaseComposerDraft, refetchComposer, resetBuildChatSession, setSoulSourceOverride])

  const applyBuildDraft = async () => {
    try {
      await applyBuildDraftRequest({
        params: {
          agent_id: agentId,
        },
      })
      await queryClient.invalidateQueries({
        queryKey: agentDetailQueryKey,
      })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      await exitBuildDraftMode(true)
      toast.success(tCommon('api.actionSuccess'))
    }
    catch {
      toast.error(tCommon('api.actionFailed'))
    }
  }

  const discardBuildDraft = async () => {
    try {
      await discardBuildDraftRequest({
        params: {
          agent_id: agentId,
        },
      })
      await exitBuildDraftMode(false)
      toast.success(tCommon('api.actionSuccess'))
    }
    catch {
      toast.error(tCommon('api.actionFailed'))
    }
  }

  useEffect(() => {
    return () => {
      cancelBuildDraftRefresh()
    }
  }, [cancelBuildDraftRefresh])

  return {
    applyBuildDraft,
    cancelBuildDraftRefresh,
    discardBuildDraft,
    isApplyingBuildDraft,
    isDiscardingBuildDraft,
    prepareBuildDraftBeforeRun: prepareBuildDraftRun,
    refreshBuildDraftAfterBuildChat,
  }
}

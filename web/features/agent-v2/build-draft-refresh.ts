import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { useCallback, useEffect, useRef } from 'react'

export function useAgentBuildDraftRefresh({
  refetchBuildDraft,
  rebaseComposerDraft,
}: {
  refetchBuildDraft: () => Promise<{ data?: { agent_soul?: AgentSoulConfig } }>
  rebaseComposerDraft: (agentSoulConfig: AgentSoulConfig) => void
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)

  const cancelBuildDraftRefresh = useCallback(() => {
    generationRef.current += 1
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const refreshBuildDraftAfterBuildChat = useCallback(
    (onRefreshed?: () => void) => {
      cancelBuildDraftRefresh()
      const generation = generationRef.current
      timerRef.current = setTimeout(async () => {
        timerRef.current = null
        try {
          const result = await refetchBuildDraft()
          if (generation !== generationRef.current) return
          const config = result.data?.agent_soul
          if (config) rebaseComposerDraft(config)
        } catch {
        } finally {
          if (generation === generationRef.current) onRefreshed?.()
        }
      }, 1000)
    },
    [cancelBuildDraftRefresh, rebaseComposerDraft, refetchBuildDraft],
  )

  useEffect(() => cancelBuildDraftRefresh, [cancelBuildDraftRefresh])

  return { cancelBuildDraftRefresh, refreshBuildDraftAfterBuildChat }
}

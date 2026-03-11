'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { consoleClient, consoleQuery } from '@/service/client'

export type ToolDependency = {
  type: string
  provider: string
  tool_name: string
}

type UseNodeSkillsParams = {
  nodeId: string
  promptTemplateKey: string
  enabled?: boolean
}

export function useNodeSkills({ nodeId, promptTemplateKey, enabled = true }: UseNodeSkillsParams) {
  const appId = useAppStore(s => s.appDetail?.id)
  const store = useStoreApi()
  const isQueryEnabled = enabled && !!appId && !!nodeId

  const queryKey = useMemo(() => {
    return [
      ...consoleQuery.workflowDraft.nodeSkills.queryKey({
        input: {
          params: { appId: appId ?? '' },
          body: {},
        },
      }),
      nodeId,
      promptTemplateKey,
    ]
  }, [appId, nodeId, promptTemplateKey])

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      const node = store.getState().getNodes().find(n => n.id === nodeId)
      return consoleClient.workflowDraft.nodeSkills({
        params: { appId: appId ?? '' },
        body: (node?.data ?? {}) as Record<string, unknown>,
      })
    },
    enabled: isQueryEnabled,
    gcTime: 0,
  })

  const toolDependencies = useMemo<ToolDependency[]>(
    () => data?.tool_dependencies ?? [],
    [data?.tool_dependencies],
  )

  const hasData = !!data

  return {
    toolDependencies,
    isLoading,
    isQueryEnabled,
    hasData,
  }
}

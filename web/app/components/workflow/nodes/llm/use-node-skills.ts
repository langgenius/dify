'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
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
  const isQueryEnabled = enabled && !!appId && !!nodeId

  const queryKey = useMemo(() => {
    return [
      ...consoleQuery.workflowDraft.nodeSkills.queryKey({
        input: {
          params: {
            appId: appId ?? '',
            nodeId,
          },
        },
      }),
      promptTemplateKey,
    ]
  }, [appId, nodeId, promptTemplateKey])

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => consoleClient.workflowDraft.nodeSkills({
      params: {
        appId: appId ?? '',
        nodeId,
      },
    }),
    enabled: isQueryEnabled,
    placeholderData: previous => previous,
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

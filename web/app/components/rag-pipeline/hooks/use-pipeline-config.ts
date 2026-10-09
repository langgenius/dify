import type { FileUploadConfigResponse } from '@/models/common'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { useWorkflowConfig } from '@/service/use-workflow'

export const usePipelineConfig = () => {
  const pipelineId = useStore((s) => s.pipelineId)
  const workflowStore = useWorkflowStore()

  const handleUpdateNodesDefaultConfigs = useCallback(
    (nodesDefaultConfigs: Record<string, any> | Record<string, any>[]) => {
      const { setNodesDefaultConfigs } = workflowStore.getState()
      let res: Record<string, any> = {}
      if (Array.isArray(nodesDefaultConfigs)) {
        nodesDefaultConfigs.forEach((item) => {
          res[item.type] = item.config
        })
      } else {
        res = nodesDefaultConfigs as Record<string, any>
      }

      setNodesDefaultConfigs!(res)
    },
    [workflowStore],
  )
  useWorkflowConfig(
    pipelineId ? `/rag/pipelines/${pipelineId}/workflows/default-workflow-block-configs` : '',
    handleUpdateNodesDefaultConfigs,
  )

  const handleUpdatePublishedAt = useCallback(
    (publishedWorkflow: FetchWorkflowDraftResponse | null) => {
      const { setPublishedAt } = workflowStore.getState()

      setPublishedAt(publishedWorkflow?.created_at ?? 0)
    },
    [workflowStore],
  )
  useWorkflowConfig(
    pipelineId ? `/rag/pipelines/${pipelineId}/workflows/publish` : '',
    handleUpdatePublishedAt,
  )

  const handleUpdateWorkflowFileUploadConfig = useCallback(
    (config: FileUploadConfigResponse) => {
      const { setFileUploadConfig } = workflowStore.getState()
      setFileUploadConfig(config)
    },
    [workflowStore],
  )
  useWorkflowConfig('/files/upload', handleUpdateWorkflowFileUploadConfig)

  const { data: dataSourceList } = useQuery(
    consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions({
      enabled: !!pipelineId,
    }),
  )
  useEffect(() => {
    if (!pipelineId || !dataSourceList) return
    workflowStore.getState().setDataSourceList?.(dataSourceList)
  }, [dataSourceList, pipelineId, workflowStore])
}

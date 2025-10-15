import { useCallback } from 'react'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { useWorkflowConfig } from '@/service/use-workflow'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useDataSourceList } from '@/service/use-pipeline'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import { basePath } from '@/utils/var'
import type { FileUploadConfigResponse } from '@/models/common'

export const usePipelineConfig = () => {
  const pipelineId = useStore(s => s.pipelineId)
  const workflowStore = useWorkflowStore()

  const handleUpdateNodesDefaultConfigs = useCallback((nodesDefaultConfigs: Record<string, any> | Record<string, any>[]) => {
    const { setNodesDefaultConfigs } = workflowStore.getState()
    let res: Record<string, any> = {}
    if (Array.isArray(nodesDefaultConfigs)) {
      nodesDefaultConfigs.forEach((item) => {
        res[item.type] = item.config
      })
    }
    else {
      res = nodesDefaultConfigs as Record<string, any>
    }

    setNodesDefaultConfigs!(res)
  }, [workflowStore])
  useWorkflowConfig(
    pipelineId ? `/rag/pipelines/${pipelineId}/workflows/default-workflow-block-configs` : '',
    handleUpdateNodesDefaultConfigs,
  )

  const handleUpdatePublishedAt = useCallback((publishedWorkflow: FetchWorkflowDraftResponse) => {
    const { setPublishedAt } = workflowStore.getState()

    setPublishedAt(publishedWorkflow?.created_at)
  }, [workflowStore])
  useWorkflowConfig(
    pipelineId ? `/rag/pipelines/${pipelineId}/workflows/publish` : '',
    handleUpdatePublishedAt,
  )

  const handleUpdateDataSourceList = useCallback((dataSourceList: DataSourceItem[]) => {
    dataSourceList.forEach((item) => {
      const icon = item.declaration.identity.icon
      if (typeof icon == 'string' && !icon.includes(basePath))
        item.declaration.identity.icon = `${basePath}${icon}`
    })
    const { setDataSourceList } = workflowStore.getState()
    setDataSourceList!(dataSourceList)
  }, [workflowStore])

  const handleUpdateWorkflowFileUploadConfig = useCallback((config: FileUploadConfigResponse) => {
    const { setFileUploadConfig } = workflowStore.getState()
    setFileUploadConfig(config)
  }, [workflowStore])
  useWorkflowConfig('/files/upload', handleUpdateWorkflowFileUploadConfig)

  useDataSourceList(!!pipelineId, handleUpdateDataSourceList)
}

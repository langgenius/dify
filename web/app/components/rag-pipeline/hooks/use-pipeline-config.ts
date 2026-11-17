import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'

export const usePipelineConfig = () => {
  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const workflowStore = useWorkflowStore()

  const { data: nodesDefaultConfigs } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.defaultWorkflowBlockConfigs.get.queryOptions({
      input: pipelineId ? { params: { pipeline_id: pipelineId } } : skipToken,
      staleTime: 0,
    }),
  )
  useEffect(() => {
    if (!nodesDefaultConfigs) return
    workflowStore
      .getState()
      .setNodesDefaultConfigs?.(
        Object.fromEntries(nodesDefaultConfigs.map(({ type, config }) => [type, config])),
      )
  }, [nodesDefaultConfigs, workflowStore])

  const { data: publishedWorkflow } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.queryOptions({
      input: pipelineId ? { params: { pipeline_id: pipelineId } } : skipToken,
      staleTime: 0,
    }),
  )
  useEffect(() => {
    if (publishedWorkflow === undefined) return
    workflowStore.getState().setPublishedAt(publishedWorkflow?.created_at ?? 0)
  }, [publishedWorkflow, workflowStore])

  const { data: fileUploadConfig } = useQuery(
    consoleQuery.files.upload.get.queryOptions({ staleTime: 0 }),
  )
  useEffect(() => {
    if (!fileUploadConfig) return
    workflowStore.getState().setFileUploadConfig(fileUploadConfig)
  }, [fileUploadConfig, workflowStore])

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

import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { toNodesDefaultConfigs } from '@/service/workflow'

export const usePipelineConfig = () => {
  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const workflowStore = useWorkflowStore()
  const pipelineInput = pipelineId ? { params: { pipeline_id: pipelineId } } : skipToken

  const { data: nodesDefaultConfigs } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.defaultWorkflowBlockConfigs.get.queryOptions({
      input: pipelineInput,
      select: toNodesDefaultConfigs,
    }),
  )
  useEffect(() => {
    if (nodesDefaultConfigs) workflowStore.getState().setNodesDefaultConfigs?.(nodesDefaultConfigs)
  }, [nodesDefaultConfigs, workflowStore])

  const { data: publishedAt } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.queryOptions({
      input: pipelineInput,
      // The backend answers null while nothing is published, which the contract does not declare.
      select: (publishedWorkflow) => publishedWorkflow?.created_at ?? 0,
    }),
  )
  useEffect(() => {
    if (publishedAt !== undefined) workflowStore.getState().setPublishedAt(publishedAt)
  }, [publishedAt, workflowStore])

  const { data: fileUploadConfig } = useQuery(consoleQuery.files.upload.get.queryOptions())
  useEffect(() => {
    if (fileUploadConfig) workflowStore.getState().setFileUploadConfig(fileUploadConfig)
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

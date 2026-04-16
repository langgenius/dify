import { useEffect, useMemo } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  useSnippetDefaultBlockConfigs,
  useSnippetDraftWorkflow,
  useSnippetPublishedWorkflow,
} from '@/service/use-snippet-workflows'
import {
  buildSnippetDetailPayload,
  useSnippetApiDetail,
} from '@/service/use-snippets'
import { getSnippetDetailMock } from '@/service/use-snippets.mock'

const normalizeNodesDefaultConfigs = (nodesDefaultConfigs: unknown) => {
  if (!nodesDefaultConfigs || typeof nodesDefaultConfigs !== 'object')
    return {}

  if (!Array.isArray(nodesDefaultConfigs))
    return nodesDefaultConfigs as Record<string, unknown>

  return nodesDefaultConfigs.reduce((acc, item) => {
    if (
      item
      && typeof item === 'object'
      && 'type' in item
      && 'config' in item
      && typeof item.type === 'string'
    ) {
      acc[item.type] = item.config
    }

    return acc
  }, {} as Record<string, unknown>)
}

const isNotFoundError = (error: unknown) => {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 404
}

export const useSnippetInit = (snippetId: string) => {
  const workflowStore = useWorkflowStore()
  const snippetApiDetail = useSnippetApiDetail(snippetId)
  const draftWorkflowQuery = useSnippetDraftWorkflow(snippetId, (draftWorkflow) => {
    const {
      setDraftUpdatedAt,
      setSyncWorkflowDraftHash,
    } = workflowStore.getState()

    setDraftUpdatedAt(draftWorkflow.updated_at)
    setSyncWorkflowDraftHash(draftWorkflow.hash)
  })
  useSnippetDefaultBlockConfigs(snippetId, (nodesDefaultConfigs) => {
    workflowStore.setState({
      nodesDefaultConfigs: normalizeNodesDefaultConfigs(nodesDefaultConfigs),
    })
  })
  const publishedWorkflowQuery = useSnippetPublishedWorkflow(snippetId, (publishedWorkflow) => {
    workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
  })

  useEffect(() => {
    if (publishedWorkflowQuery.isLoading)
      return

    workflowStore.getState().setPublishedAt(publishedWorkflowQuery.data?.created_at ?? 0)
  }, [publishedWorkflowQuery.data?.created_at, publishedWorkflowQuery.isLoading, workflowStore])

  const mockData = useMemo(() => getSnippetDetailMock(snippetId), [snippetId])
  const shouldUseMockData = !snippetApiDetail.isLoading && !snippetApiDetail.data && !!mockData

  const data = useMemo(() => {
    if (snippetApiDetail.data && !draftWorkflowQuery.isLoading)
      return buildSnippetDetailPayload(snippetApiDetail.data, draftWorkflowQuery.data)

    if (shouldUseMockData)
      return mockData

    if (snippetApiDetail.error && isNotFoundError(snippetApiDetail.error))
      return null

    return undefined
  }, [draftWorkflowQuery.data, draftWorkflowQuery.isLoading, mockData, shouldUseMockData, snippetApiDetail.data, snippetApiDetail.error])

  return {
    ...snippetApiDetail,
    data,
    isLoading: shouldUseMockData ? false : snippetApiDetail.isLoading || draftWorkflowQuery.isLoading,
  }
}

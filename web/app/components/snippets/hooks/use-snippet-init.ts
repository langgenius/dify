import type { SnippetWorkflow } from '@/types/snippet'
import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  fetchSnippetDraftWorkflow,
  useSnippetDefaultBlockConfigs,
  useSnippetPublishedWorkflow,
} from '@/service/use-snippet-workflows'
import {
  buildSnippetDetailPayload,
  useSnippetApiDetail,
} from '@/service/use-snippets'

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

type DraftWorkflowState = {
  snippetId: string
  data?: SnippetWorkflow
  isLoaded: boolean
}

export const useSnippetInit = (snippetId: string) => {
  const workflowStore = useWorkflowStore()
  const snippetApiDetail = useSnippetApiDetail(snippetId)
  const [draftWorkflowState, setDraftWorkflowState] = useState<DraftWorkflowState>({
    snippetId: '',
    isLoaded: false,
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

  useEffect(() => {
    let ignore = false

    if (!snippetId)
      return

    fetchSnippetDraftWorkflow(snippetId)
      .then((response) => {
        if (ignore)
          return

        if (response) {
          const {
            setDraftUpdatedAt,
            setSyncWorkflowDraftHash,
          } = workflowStore.getState()

          setDraftUpdatedAt(response.updated_at)
          setSyncWorkflowDraftHash(response.hash)
        }

        setDraftWorkflowState({
          snippetId,
          data: response,
          isLoaded: true,
        })
      })
      .catch(() => {
        // Keep the canvas gated on unexpected draft fetch failures.
        // `fetchSnippetDraftWorkflow` resolves with undefined for 404, so this
        // branch represents a real initialization failure rather than "no draft".
      })

    return () => {
      ignore = true
    }
  }, [snippetId, workflowStore])

  const isDraftWorkflowLoading = !!snippetId && (!draftWorkflowState.isLoaded || draftWorkflowState.snippetId !== snippetId)
  const draftWorkflow = draftWorkflowState.snippetId === snippetId ? draftWorkflowState.data : undefined

  const data = useMemo(() => {
    if (snippetApiDetail.data && !isDraftWorkflowLoading)
      return buildSnippetDetailPayload(snippetApiDetail.data, draftWorkflow)

    if (snippetApiDetail.error && isNotFoundError(snippetApiDetail.error))
      return null

    return undefined
  }, [draftWorkflow, isDraftWorkflowLoading, snippetApiDetail.data, snippetApiDetail.error])

  return {
    ...snippetApiDetail,
    data,
    isLoading: snippetApiDetail.isLoading || isDraftWorkflowLoading,
  }
}

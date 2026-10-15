import type { SnippetWorkflow } from '@/types/snippet'
import isEqual from 'fast-deep-equal'
import { useEffect, useMemo, useState } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { toastRequestError } from '@/app/notifications/request-error'
import { useLoadFailureMeta, useLoadFailureToast } from '@/hooks/use-load-failure-meta'
import { isNotFoundError } from '@/service/http-error'
import {
  fetchSnippetDraftWorkflow,
  useSnippetDefaultBlockConfigs,
  useSnippetPublishedWorkflow,
} from '@/service/use-snippet-workflows'
import { buildSnippetDetailPayload, useSnippetApiDetail } from '@/service/use-snippets'

const normalizeNodesDefaultConfigs = (nodesDefaultConfigs: unknown) => {
  if (!nodesDefaultConfigs || typeof nodesDefaultConfigs !== 'object') return {}

  if (!Array.isArray(nodesDefaultConfigs)) return nodesDefaultConfigs as Record<string, unknown>

  return nodesDefaultConfigs.reduce(
    (acc, item) => {
      if (
        item &&
        typeof item === 'object' &&
        'type' in item &&
        'config' in item &&
        typeof item.type === 'string'
      ) {
        acc[item.type] = item.config
      }

      return acc
    },
    {} as Record<string, unknown>,
  )
}

const getComparableWorkflowData = (workflow?: SnippetWorkflow | null) => {
  return {
    graph: workflow?.graph ?? {},
    inputFields: Array.isArray(workflow?.input_fields) ? workflow.input_fields : [],
  }
}

type DraftWorkflowState = {
  snippetId: string
  data?: SnippetWorkflow
  isLoaded: boolean
}

export const useSnippetInit = (snippetId: string) => {
  const workflowStore = useWorkflowStore()
  const snippetApiDetail = useSnippetApiDetail(snippetId)
  // A missing snippet has a page of its own.
  useLoadFailureToast(
    snippetApiDetail.error && !isNotFoundError(snippetApiDetail.error)
      ? snippetApiDetail.error
      : null,
  )
  const [draftWorkflowState, setDraftWorkflowState] = useState<DraftWorkflowState>({
    snippetId: '',
    isLoaded: false,
  })
  useSnippetDefaultBlockConfigs(snippetId, (nodesDefaultConfigs) => {
    workflowStore.setState({
      nodesDefaultConfigs: normalizeNodesDefaultConfigs(nodesDefaultConfigs),
    })
  })
  const loadFailureMeta = useLoadFailureMeta()
  const publishedWorkflowQuery = useSnippetPublishedWorkflow(
    snippetId,
    (publishedWorkflow) => {
      workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
    },
    { meta: loadFailureMeta },
  )

  useEffect(() => {
    if (publishedWorkflowQuery.isLoading) return

    workflowStore.getState().setPublishedAt(publishedWorkflowQuery.data?.created_at ?? 0)
  }, [publishedWorkflowQuery.data?.created_at, publishedWorkflowQuery.isLoading, workflowStore])

  useEffect(() => {
    let ignore = false

    if (!snippetId) return

    fetchSnippetDraftWorkflow(snippetId)
      .then((response) => {
        if (ignore) return

        if (response) {
          const { setDraftUpdatedAt, setSyncWorkflowDraftHash } = workflowStore.getState()

          setDraftUpdatedAt(response.updated_at)
          setSyncWorkflowDraftHash(response.hash)
        }

        workflowStore.setState({ isWorkflowDataLoaded: true })
        setDraftWorkflowState({
          snippetId,
          data: response,
          isLoaded: true,
        })
      })
      .catch((error: unknown) => {
        // Keep the canvas gated on unexpected draft fetch failures.
        // `fetchSnippetDraftWorkflow` resolves with undefined for 404, so this
        // branch represents a real initialization failure rather than "no draft".
        if (!ignore) toastRequestError(error, loadFailureMeta.errorMessage)
      })

    return () => {
      ignore = true
    }
  }, [loadFailureMeta.errorMessage, snippetId, workflowStore])

  const isDraftWorkflowLoading =
    !!snippetId && (!draftWorkflowState.isLoaded || draftWorkflowState.snippetId !== snippetId)
  const draftWorkflow =
    draftWorkflowState.snippetId === snippetId ? draftWorkflowState.data : undefined

  const data = useMemo(() => {
    if (snippetApiDetail.data && !publishedWorkflowQuery.isLoading && !isDraftWorkflowLoading) {
      const publishedWorkflow = publishedWorkflowQuery.data
      const effectiveDraftWorkflow = draftWorkflow ?? publishedWorkflow

      return {
        snippet: buildSnippetDetailPayload(snippetApiDetail.data, publishedWorkflow).snippet,
        published: buildSnippetDetailPayload(snippetApiDetail.data, publishedWorkflow),
        draft: buildSnippetDetailPayload(snippetApiDetail.data, effectiveDraftWorkflow),
        draftWorkflow,
        publishedWorkflow,
        hasDraftChanges:
          !!draftWorkflow &&
          !isEqual(
            getComparableWorkflowData(draftWorkflow),
            getComparableWorkflowData(publishedWorkflow),
          ),
      }
    }

    if (snippetApiDetail.error && isNotFoundError(snippetApiDetail.error)) return null

    return undefined
  }, [
    draftWorkflow,
    isDraftWorkflowLoading,
    publishedWorkflowQuery.data,
    publishedWorkflowQuery.isLoading,
    snippetApiDetail.data,
    snippetApiDetail.error,
  ])

  return {
    ...snippetApiDetail,
    data,
    isLoading:
      snippetApiDetail.isLoading || publishedWorkflowQuery.isLoading || isDraftWorkflowLoading,
  }
}

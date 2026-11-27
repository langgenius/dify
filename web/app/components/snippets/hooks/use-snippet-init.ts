import type { SnippetWorkflow } from '@/types/snippet'
import { queryOptions, useQuery } from '@tanstack/react-query'
import isEqual from 'fast-deep-equal'
import { useEffect, useMemo, useState } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { reportRequestError } from '@/app/query-error-toast'
import { consoleQuery } from '@/service/console'
import { isNotFoundError } from '@/service/http-error'
import {
  fetchSnippetDraftWorkflow,
  snippetPublishedWorkflowQueryOptions,
} from '@/service/snippet-queries'
import { buildSnippetDetailPayload } from '../utils/snippet-detail-payload'

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
  const snippetApiDetail = useQuery(
    consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryOptions({
      input: { params: { snippet_id: snippetId } },
      enabled: !!snippetId,
    }),
  )
  const [draftWorkflowState, setDraftWorkflowState] = useState<DraftWorkflowState>({
    snippetId: '',
    isLoaded: false,
  })
  const defaultBlockConfigsOptions =
    consoleQuery.snippets.bySnippetId.workflows.defaultWorkflowBlockConfigs.get.queryOptions({
      input: { params: { snippet_id: snippetId } },
      enabled: !!snippetId,
    })
  useQuery(
    queryOptions({
      ...defaultBlockConfigsOptions,
      queryFn: async (context) => {
        const nodesDefaultConfigs = await defaultBlockConfigsOptions.queryFn(context)
        workflowStore.setState({
          nodesDefaultConfigs: normalizeNodesDefaultConfigs(nodesDefaultConfigs),
        })
        return nodesDefaultConfigs
      },
    }),
  )
  const publishedWorkflowOptions = snippetPublishedWorkflowQueryOptions(snippetId)
  const publishedWorkflowQuery = useQuery(
    queryOptions({
      ...publishedWorkflowOptions,
      queryFn: async (context) => {
        const publishedWorkflow = await publishedWorkflowOptions.queryFn(context)
        if (publishedWorkflow) workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
        return publishedWorkflow
      },
    }),
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
        // Keep the canvas gated on unexpected draft fetch failures and report them.
        // `fetchSnippetDraftWorkflow` resolves with undefined for 404, so this
        // branch represents a real initialization failure rather than "no draft".
        if (!ignore) reportRequestError(error)
      })

    return () => {
      ignore = true
    }
  }, [snippetId, workflowStore])

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

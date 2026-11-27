'use client'

import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { snippetIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import SnippetLayout from './components/snippet-layout'
import SnippetMain from './components/snippet-main'
import { useSnippetInit } from './hooks/use-snippet-init'

type SnippetPageProps = {
  snippetId: string
}

const SnippetPageLoading = ({ snippetId }: SnippetPageProps) => {
  return (
    <SnippetLayout snippetId={snippetId} section="orchestrate">
      <div className="flex h-full items-center justify-center bg-background-body">
        <LoadingPlaceholder />
      </div>
    </SnippetLayout>
  )
}

const SnippetPage = () => {
  const { t } = useTranslation(['workflow', 'common'])
  const { snippetId } = useAtomValue(snippetIdentityAtom)
  const { data, isLoading, error, draftError, isFetching, refetch } = useSnippetInit(snippetId)
  // A missing snippet resolves `data` to null; only another failed first load of the detail or
  // the draft has no page to show. A failed refetch keeps the loaded snippet and is reported by the
  // query cache. The draft keeps the server's text for codes the catalog does not know.
  const loadError = data === undefined ? (error ?? draftError) : undefined
  const loadErrorMessage = useRequestErrorMessage(
    loadError,
    error ? t(($) => $['common.loadFailed'], { ns: 'workflow' }) : undefined,
  )
  const publishedNodesData = useMemo(() => {
    if (!data) return []

    return initialNodes(data.published.graph.nodes, data.published.graph.edges)
  }, [data])
  const publishedEdgesData = useMemo(() => {
    if (!data) return []

    return initialEdges(data.published.graph.edges, data.published.graph.nodes)
  }, [data])
  const draftNodesData = useMemo(() => {
    if (!data) return []

    return initialNodes(data.draft.graph.nodes, data.draft.graph.edges)
  }, [data])
  const draftEdgesData = useMemo(() => {
    if (!data) return []

    return initialEdges(data.draft.graph.edges, data.draft.graph.nodes)
  }, [data])

  if (loadErrorMessage) {
    return (
      <SnippetLayout snippetId={snippetId} section="orchestrate">
        <div className="flex h-full items-center justify-center bg-background-body p-4">
          <Alert type="error" className="w-full max-w-100">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button
                size="small"
                variant="secondary"
                loading={isFetching}
                onClick={() => void refetch()}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        </div>
      </SnippetLayout>
    )
  }

  if (!data || isLoading) {
    return <SnippetPageLoading snippetId={snippetId} />
  }

  const hasPublishedWorkflow = !!data.publishedWorkflow
  const initialWorkflowNodesData = hasPublishedWorkflow ? publishedNodesData : draftNodesData
  const initialWorkflowEdgesData = hasPublishedWorkflow ? publishedEdgesData : draftEdgesData

  return (
    <SnippetLayout snippetId={snippetId} snippet={data.snippet} section="orchestrate">
      <WorkflowWithDefaultContext edges={initialWorkflowEdgesData} nodes={initialWorkflowNodesData}>
        <SnippetMain
          payload={data.published}
          draftPayload={data.draft}
          hasInitialDraftChanges={data.hasDraftChanges}
          hasPublishedWorkflow={hasPublishedWorkflow}
          nodes={publishedNodesData}
          edges={publishedEdgesData}
          viewport={data.published.graph.viewport}
          draftNodes={draftNodesData}
          draftEdges={draftEdgesData}
          draftViewport={data.draft.graph.viewport}
        />
      </WorkflowWithDefaultContext>
    </SnippetLayout>
  )
}

const SnippetPageWrapper = ({ snippetId }: SnippetPageProps) => {
  return (
    <EditorResourceScope resource={{ kind: 'snippet', snippetId }}>
      <WorkflowContextProvider>
        <SnippetPage />
      </WorkflowContextProvider>
    </EditorResourceScope>
  )
}

export default SnippetPageWrapper

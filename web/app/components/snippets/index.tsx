'use client'

import { useMemo } from 'react'
import Loading from '@/app/components/base/loading'
import SnippetAndEvaluationPlanGuard from '@/app/components/billing/snippet-and-evaluation-plan-guard'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import SnippetLayout from './components/snippet-layout'
import SnippetMain from './components/snippet-main'
import { useSnippetInit } from './hooks/use-snippet-init'

type SnippetPageProps = {
  snippetId: string
}

const SnippetPageLoading = () => {
  return (
    <div className="flex h-full items-center justify-center bg-background-body">
      <Loading />
    </div>
  )
}

const SnippetPage = ({ snippetId }: SnippetPageProps) => {
  const { data, isLoading } = useSnippetInit(snippetId)
  const nodesData = useMemo(() => {
    if (!data)
      return []

    return initialNodes(data.graph.nodes, data.graph.edges)
  }, [data])
  const edgesData = useMemo(() => {
    if (!data)
      return []

    return initialEdges(data.graph.edges, data.graph.nodes)
  }, [data])

  if (!data || isLoading) {
    return <SnippetPageLoading />
  }

  return (
    <SnippetLayout
      snippetId={snippetId}
      snippet={data.snippet}
      section="orchestrate"
    >
      <WorkflowWithDefaultContext
        edges={edgesData}
        nodes={nodesData}
      >
        <SnippetMain
          key={snippetId}
          snippetId={snippetId}
          payload={data}
          nodes={nodesData}
          edges={edgesData}
          viewport={data.graph.viewport}
        />
      </WorkflowWithDefaultContext>
    </SnippetLayout>
  )
}

const SnippetPageWrapper = ({ snippetId }: SnippetPageProps) => {
  return (
    <SnippetAndEvaluationPlanGuard fallbackHref="/apps">
      <WorkflowContextProvider>
        <SnippetPage snippetId={snippetId} />
      </WorkflowContextProvider>
    </SnippetAndEvaluationPlanGuard>
  )
}

export default SnippetPageWrapper

'use client'

import type { SnippetSection } from '@/models/snippet'
import { useMemo } from 'react'
import Loading from '@/app/components/base/loading'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import SnippetMain from './components/snippet-main'
import { useSnippetInit } from './hooks/use-snippet-init'

type SnippetPageProps = {
  snippetId: string
  section?: SnippetSection
}

const SnippetPage = ({
  snippetId,
  section = 'orchestrate',
}: SnippetPageProps) => {
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
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  return (
    <WorkflowWithDefaultContext
      edges={edgesData}
      nodes={nodesData}
    >
      <SnippetMain
        key={snippetId}
        snippetId={snippetId}
        section={section}
        payload={data}
        nodes={nodesData}
        edges={edgesData}
        viewport={data.graph.viewport}
      />
    </WorkflowWithDefaultContext>
  )
}

const SnippetPageWrapper = (props: SnippetPageProps) => {
  return (
    <WorkflowContextProvider>
      <SnippetPage {...props} />
    </WorkflowContextProvider>
  )
}

export default SnippetPageWrapper

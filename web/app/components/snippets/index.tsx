'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
}

const SnippetPage = ({
  snippetId,
}: SnippetPageProps) => {
  const { t } = useTranslation('snippet')
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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body px-6">
        <div className="w-full max-w-md rounded-2xl border border-divider-subtle bg-components-card-bg p-8 text-center shadow-sm">
          <div className="text-3xl font-semibold text-text-primary">404</div>
          <div className="pt-3 text-text-primary system-md-semibold">{t('notFoundTitle')}</div>
          <div className="pt-2 text-text-tertiary system-sm-regular">{t('notFoundDescription')}</div>
        </div>
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

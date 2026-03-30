'use client'

import { useMemo } from 'react'
import Loading from '@/app/components/base/loading'
import Evaluation from '@/app/components/evaluation'
import { buildSnippetDetailPayload, useSnippetApiDetail } from '@/service/use-snippets'
import { getSnippetDetailMock } from '@/service/use-snippets.mock'
import SnippetLayout from './components/snippet-layout'

type SnippetEvaluationPageProps = {
  snippetId: string
}

const SnippetEvaluationPage = ({ snippetId }: SnippetEvaluationPageProps) => {
  const snippetApiDetail = useSnippetApiDetail(snippetId)
  const mockSnippet = useMemo(() => getSnippetDetailMock(snippetId)?.snippet, [snippetId])
  const snippet = useMemo(() => {
    if (snippetApiDetail.data)
      return buildSnippetDetailPayload(snippetApiDetail.data).snippet

    if (!snippetApiDetail.isLoading)
      return mockSnippet

    return undefined
  }, [mockSnippet, snippetApiDetail.data, snippetApiDetail.isLoading])

  if (!snippet || snippetApiDetail.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  return (
    <SnippetLayout
      snippetId={snippetId}
      snippet={snippet}
      section="evaluation"
    >
      <Evaluation resourceType="snippet" resourceId={snippetId} />
    </SnippetLayout>
  )
}

export default SnippetEvaluationPage

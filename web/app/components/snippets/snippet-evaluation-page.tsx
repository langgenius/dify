'use client'

import { useMemo } from 'react'
import Loading from '@/app/components/base/loading'
import SnippetAndEvaluationPlanGuard from '@/app/components/billing/snippet-and-evaluation-plan-guard'
import Evaluation from '@/app/components/evaluation'
import {
  buildSnippetDetailPayload,
  useSnippetApiDetail,
} from '@/service/use-snippets'
import SnippetLayout from './components/snippet-layout'

type SnippetEvaluationPageProps = {
  snippetId: string
}

const SnippetEvaluationPage = ({ snippetId }: SnippetEvaluationPageProps) => {
  const { data, isLoading } = useSnippetApiDetail(snippetId)
  const snippet = useMemo(() => {
    if (!data)
      return undefined

    return buildSnippetDetailPayload(data).snippet
  }, [data])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  if (!snippet)
    return null

  return (
    <SnippetAndEvaluationPlanGuard fallbackHref="/apps">
      <SnippetLayout
        snippetId={snippetId}
        snippet={snippet}
        section="evaluation"
      >
        <Evaluation resourceType="snippets" resourceId={snippetId} />
      </SnippetLayout>
    </SnippetAndEvaluationPlanGuard>
  )
}

export default SnippetEvaluationPage

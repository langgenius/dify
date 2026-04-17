'use client'

import { useMemo } from 'react'
import SnippetAndEvaluationPlanGuard from '@/app/components/billing/snippet-and-evaluation-plan-guard'
import Evaluation from '@/app/components/evaluation'
import { getSnippetDetailMock } from '@/service/use-snippets.mock'
import SnippetLayout from './components/snippet-layout'

type SnippetEvaluationPageProps = {
  snippetId: string
}

const SnippetEvaluationPage = ({ snippetId }: SnippetEvaluationPageProps) => {
  const mockSnippet = useMemo(() => getSnippetDetailMock(snippetId)?.snippet, [snippetId])
  const snippet = mockSnippet

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

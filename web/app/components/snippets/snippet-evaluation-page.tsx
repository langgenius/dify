'use client'

import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import SnippetAndEvaluationPlanGuard from '@/app/components/billing/snippet-and-evaluation-plan-guard'
import Evaluation from '@/app/components/evaluation'
import { useRouter } from '@/next/navigation'
import { buildSnippetDetailPayload, useSnippetApiDetail } from '@/service/use-snippets'
import SnippetLayout from './components/snippet-layout'
import { useSnippetDetailStore } from './store'

type SnippetEvaluationPageProps = {
  snippetId: string
}

const SnippetEvaluationPage = ({ snippetId }: SnippetEvaluationPageProps) => {
  const router = useRouter()
  const { data, isLoading } = useSnippetApiDetail(snippetId)
  const { reset, setNavigationState } = useSnippetDetailStore(
    useShallow((state) => ({
      reset: state.reset,
      setNavigationState: state.setNavigationState,
    })),
  )
  const snippet = useMemo(() => {
    if (!data) return undefined

    return buildSnippetDetailPayload(data).snippet
  }, [data])

  useEffect(() => {
    reset()

    return () => reset()
  }, [reset, snippetId])

  useEffect(() => {
    if (!snippet) return

    if (!snippet.is_published) {
      router.replace(`/snippets/${snippetId}/orchestrate`)
      return
    }

    setNavigationState({
      snippetId,
      snippet,
      readonly: true,
      onFieldsChange: undefined,
    })
  }, [router, setNavigationState, snippet, snippetId])

  if (isLoading || !snippet || !snippet.is_published) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <LoadingPlaceholder />
      </div>
    )
  }

  return (
    <SnippetAndEvaluationPlanGuard fallbackHref={`/snippets/${snippetId}/orchestrate`}>
      <SnippetLayout snippetId={snippetId} snippet={snippet} section="evaluation">
        <Evaluation resourceType="snippets" resourceId={snippetId} />
      </SnippetLayout>
    </SnippetAndEvaluationPlanGuard>
  )
}

export default SnippetEvaluationPage

'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import EvaluationPlanGuard from '@/app/components/billing/evaluation-plan-guard'
import Evaluation from '@/app/components/evaluation'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import SnippetLayout from './components/snippet-layout'
import { useSnippetDetailStore } from './store'
import { buildSnippetDetailPayload } from './utils/snippet-detail-payload'

type SnippetEvaluationPageProps = {
  snippetId: string
}

const SnippetEvaluationPage = ({ snippetId }: SnippetEvaluationPageProps) => {
  const { t } = useTranslation(['evaluation'])
  const router = useRouter()
  const { data, isLoading } = useQuery(
    consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryOptions({
      input: { params: { snippet_id: snippetId } },
      enabled: !!snippetId,
    }),
  )
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
      // Say why the evaluation link went to the editor instead.
      toast.info(t(($) => $.unavailableUntilPublished))
      router.replace(`/snippets/${snippetId}/orchestrate`)
      return
    }

    setNavigationState({
      snippetId,
      snippet,
      readonly: true,
      onFieldsChange: undefined,
    })
  }, [router, setNavigationState, snippet, snippetId, t])

  if (isLoading || !snippet || !snippet.is_published) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <LoadingPlaceholder />
      </div>
    )
  }

  return (
    <SnippetLayout snippetId={snippetId} snippet={snippet} section="evaluation">
      <EvaluationPlanGuard
        fallbackHref={`/snippets/${snippetId}/orchestrate`}
        resourceType="snippets"
      >
        <Evaluation resourceType="snippets" resourceId={snippetId} />
      </EvaluationPlanGuard>
    </SnippetLayout>
  )
}

export default SnippetEvaluationPage

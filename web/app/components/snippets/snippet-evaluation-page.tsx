'use client'

import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
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
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import SnippetLayout from './components/snippet-layout'
import { useSnippetDetailStore } from './store'
import { buildSnippetDetailPayload } from './utils/snippet-detail-payload'

type SnippetEvaluationPageProps = {
  snippetId: string
}

const SnippetEvaluationPage = ({ snippetId }: SnippetEvaluationPageProps) => {
  const { t } = useTranslation(['evaluation', 'workflow', 'common'])
  const router = useRouter()
  const snippetQuery = useQuery(
    consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryOptions({
      input: { params: { snippet_id: snippetId } },
      enabled: !!snippetId,
    }),
  )
  const { data, isLoading } = snippetQuery
  const snippetLoad = useOwnedQueryError(snippetQuery)
  const loadErrorMessage = useRequestErrorMessage(
    snippetLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
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

  if (snippetLoad) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body p-4">
        <Alert type="error" className="w-full max-w-100">
          <AlertTitle>{loadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button
              size="small"
              variant="secondary"
              loading={snippetLoad.retrying}
              onClick={snippetLoad.retry}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }

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

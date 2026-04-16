import Apps from '@/app/components/apps'
import SnippetAndEvaluationPlanGuard from '@/app/components/billing/snippet-and-evaluation-plan-guard'

const SnippetsPage = () => {
  return (
    <SnippetAndEvaluationPlanGuard fallbackHref="/apps">
      <Apps pageType="snippets" />
    </SnippetAndEvaluationPlanGuard>
  )
}

export default SnippetsPage

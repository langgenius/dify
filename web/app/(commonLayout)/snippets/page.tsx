import Apps from '@/app/components/apps'
import SnippetPlanGuard from '@/app/components/billing/snippet-plan-guard'

const SnippetsPage = () => {
  return (
    <SnippetPlanGuard fallbackHref="/apps">
      <Apps pageType="snippets" />
    </SnippetPlanGuard>
  )
}

export default SnippetsPage

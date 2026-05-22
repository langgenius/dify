import SnippetPlanGuard from '@/app/components/billing/snippet-plan-guard'
import SnippetList from '@/app/components/snippet-list'

const SnippetsPage = () => {
  return (
    <SnippetPlanGuard fallbackHref="/apps">
      <SnippetList />
    </SnippetPlanGuard>
  )
}

export default SnippetsPage

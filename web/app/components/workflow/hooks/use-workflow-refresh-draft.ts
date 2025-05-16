import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useWorkflowRefreshDraft = () => {
  const handleRefreshWorkflowDraft = useHooksStore(s => s.handleRefreshWorkflowDraft)

  return {
    handleRefreshWorkflowDraft,
  }
}

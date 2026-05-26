import { useHooksStore } from '../hooks-store'

export const useWorkflowRefreshDraft = () => {
  const handleRefreshWorkflowDraft = useHooksStore(s => s.handleRefreshWorkflowDraft)

  return {
    handleRefreshWorkflowDraft,
  }
}

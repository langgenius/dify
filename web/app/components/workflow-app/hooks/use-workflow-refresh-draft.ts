import { useCallback } from 'react'

export const useWorkflowRefreshDraft = () => {
  const handleRefreshWorkflowDraft = useCallback(() => {
    // No-op function to prevent repeated API calls on tab switch
  }, [])

  return {
    handleRefreshWorkflowDraft,
  }
}

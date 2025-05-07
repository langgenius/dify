import { useCallback } from 'react'

export const useWorkflowRefreshDraft = () => {
  const handleRefreshWorkflowDraft = useCallback(() => {
    return true
  }, [])

  return {
    handleRefreshWorkflowDraft,
  }
}

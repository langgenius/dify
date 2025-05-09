import { useCallback } from 'react'

export const usePipelineRefreshDraft = () => {
  const handleRefreshWorkflowDraft = useCallback(() => {
    return true
  }, [])

  return {
    handleRefreshWorkflowDraft,
  }
}

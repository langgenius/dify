import { useCallback, useEffect } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useAutoOnboarding = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const checkAndShowOnboarding = useCallback(() => {
    const { getNodes } = store.getState()
    const {
      showOnboarding,
      hasShownOnboarding,
      notInitialWorkflow,
      setShowOnboarding,
      setHasShownOnboarding,
      setShouldAutoOpenStartNodeSelector,
    } = workflowStore.getState()

    // Skip if already showing onboarding or it's the initial workflow creation
    if (showOnboarding || notInitialWorkflow)
      return

    const nodes = getNodes()

    // Check if canvas is completely empty (no nodes at all)
    // Only trigger onboarding when canvas is completely blank to avoid data loss
    const isCompletelyEmpty = nodes.length === 0

    // Show onboarding only if canvas is completely empty and we haven't shown it before in this session
    if (isCompletelyEmpty && !hasShownOnboarding) {
      setShowOnboarding?.(true)
      setHasShownOnboarding?.(true)
      setShouldAutoOpenStartNodeSelector?.(true)
    }
  }, [store, workflowStore])

  const handleOnboardingClose = useCallback(() => {
    const {
      setShowOnboarding,
      setHasShownOnboarding,
      setShouldAutoOpenStartNodeSelector,
      hasSelectedStartNode,
      setHasSelectedStartNode,
    } = workflowStore.getState()
    setShowOnboarding?.(false)
    setHasShownOnboarding?.(true)
    if (hasSelectedStartNode)
      setHasSelectedStartNode?.(false)
    else
      setShouldAutoOpenStartNodeSelector?.(false)
  }, [workflowStore])

  // Check on mount and when nodes change
  useEffect(() => {
    // Small delay to ensure the workflow data is loaded
    const timer = setTimeout(() => {
      checkAndShowOnboarding()
    }, 500)

    return () => clearTimeout(timer)
  }, [checkAndShowOnboarding])

  return {
    checkAndShowOnboarding,
    handleOnboardingClose,
  }
}

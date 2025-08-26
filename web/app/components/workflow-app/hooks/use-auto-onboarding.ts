import { useCallback, useEffect } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'

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
    } = workflowStore.getState()

    // Skip if already showing onboarding or it's the initial workflow creation
    if (showOnboarding || notInitialWorkflow)
      return

    const nodes = getNodes()
    const startNodeTypes = [
      BlockEnum.Start,
      BlockEnum.TriggerSchedule,
      BlockEnum.TriggerWebhook,
      BlockEnum.TriggerPlugin,
    ]

    // Check if canvas is empty (no nodes or no start nodes)
    const hasStartNode = nodes.some(node => startNodeTypes.includes(node.data.type))
    const isEmpty = nodes.length === 0 || !hasStartNode

    // Show onboarding if canvas is empty and we haven't shown it before in this session
    if (isEmpty && !hasShownOnboarding) {
      setShowOnboarding(true)
      setHasShownOnboarding(true)
    }
  }, [store, workflowStore])

  const handleOnboardingClose = useCallback(() => {
    const { setShowOnboarding, setHasShownOnboarding } = workflowStore.getState()
    setShowOnboarding(false)
    setHasShownOnboarding(true)
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

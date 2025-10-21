import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useWorkflowStartRun = () => {
  const handleStartWorkflowRun = useHooksStore(s => s.handleStartWorkflowRun)
  const handleWorkflowStartRunInWorkflow = useHooksStore(s => s.handleWorkflowStartRunInWorkflow)
  const handleWorkflowStartRunInChatflow = useHooksStore(s => s.handleWorkflowStartRunInChatflow)

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowStartRunInChatflow,
  }
}

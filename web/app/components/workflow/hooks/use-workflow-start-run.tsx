import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useWorkflowStartRun = () => {
  const handleStartWorkflowRun = useHooksStore(s => s.handleStartWorkflowRun)
  const handleWorkflowStartRunInWorkflow = useHooksStore(s => s.handleWorkflowStartRunInWorkflow)
  const handleWorkflowStartRunInChatflow = useHooksStore(s => s.handleWorkflowStartRunInChatflow)
  const handleWorkflowTriggerScheduleRunInWorkflow = useHooksStore(s => s.handleWorkflowTriggerScheduleRunInWorkflow)
  const handleWorkflowTriggerWebhookRunInWorkflow = useHooksStore(s => s.handleWorkflowTriggerWebhookRunInWorkflow)

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowStartRunInChatflow,
    handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow,
  }
}

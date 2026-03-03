import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useWorkflowRun = () => {
  const handleBackupDraft = useHooksStore(s => s.handleBackupDraft)
  const handleLoadBackupDraft = useHooksStore(s => s.handleLoadBackupDraft)
  const handleRestoreFromPublishedWorkflow = useHooksStore(s => s.handleRestoreFromPublishedWorkflow)
  const handleRun = useHooksStore(s => s.handleRun)
  const handleRerun = useHooksStore(s => s.handleRerun)
  const handleStopRun = useHooksStore(s => s.handleStopRun)

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRun,
    handleRerun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}

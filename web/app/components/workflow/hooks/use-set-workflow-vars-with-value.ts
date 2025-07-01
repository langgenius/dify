import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useSetWorkflowVarsWithValue = () => {
  const fetchInspectVars = useHooksStore(s => s.doSyncWorkflowDraft)

  return {
    fetchInspectVars,
  }
}

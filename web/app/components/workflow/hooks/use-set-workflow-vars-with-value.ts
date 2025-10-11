import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useSetWorkflowVarsWithValue = () => {
  const fetchInspectVars = useHooksStore(s => s.fetchInspectVars)

  return {
    fetchInspectVars,
  }
}

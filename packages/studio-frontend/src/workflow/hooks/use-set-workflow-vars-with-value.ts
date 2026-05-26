import { useHooksStore } from '../hooks-store'

export const useSetWorkflowVarsWithValue = () => {
  const fetchInspectVars = useHooksStore(s => s.fetchInspectVars)

  return {
    fetchInspectVars,
  }
}

import { useCurrentVarsStore } from '../current-vars-store/store'
import { useLastRunStore } from '../last-run-store/store'
const useCurrentVars = () => {
  const currentVars = useCurrentVarsStore(state => state.nodes)
  const getCurrentVar = useCurrentVarsStore(state => state.getVar)
  const getLastRunVar = useLastRunStore(state => state.getVar)
  const setCurrentVar = useCurrentVarsStore(state => state.setVar)
  const clearCurrentVars = useCurrentVarsStore(state => state.clearVars)
  const clearNodeVars = useCurrentVarsStore(state => state.clearNodeVars)

  const isVarChanged = (nodeId: string, key: string) => {
    return getCurrentVar(nodeId, key) !== getLastRunVar(nodeId, key)
  }

  const resetToLastRunVar = (nodeId: string, key: string) => {
    const lastRunVar = getLastRunVar(nodeId, key)
    if (lastRunVar)
      setCurrentVar(nodeId, key, lastRunVar)
  }

  return {
    currentVars,
    isVarChanged,
    clearCurrentVars,
    clearNodeVars,
    setCurrentVar,
    resetToLastRunVar,
  }
}

export default useCurrentVars

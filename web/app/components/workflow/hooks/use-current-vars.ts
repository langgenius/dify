import { useWorkflowStore } from '../store'
const useCurrentVars = () => {
  const workflowStore = useWorkflowStore()
  const {
    nodes: currentNodes,
    getInspectVar: getCurrentVar,
    setInspectVar: setCurrentVar,
    clearInspectVars: clearCurrentVars,
    clearNodeInspectVars: clearCurrentNodeVars,
    getLastRunVar,
    getLastRunInfos,
  } = workflowStore.getState()

  const isVarChanged = (nodeId: string, key: string) => {
    return getCurrentVar(nodeId, key) !== getLastRunVar(nodeId, key)
  }

  const resetToLastRunVar = (nodeId: string, key: string) => {
    const lastRunVar = getLastRunVar(nodeId, key)
    if (lastRunVar)
      setCurrentVar(nodeId, key, lastRunVar)
  }

  return {
    currentVars: currentNodes,
    getLastRunInfos,
    isVarChanged,
    clearCurrentVars,
    clearCurrentNodeVars,
    setCurrentVar,
    resetToLastRunVar,
  }
}

export default useCurrentVars

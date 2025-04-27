import { useWorkflowStore } from '../store'
import { BlockEnum, type ValueSelector, type VarType } from '../types'
const useCurrentVars = () => {
  const workflowStore = useWorkflowStore()
  const {
    conversationVars,
    nodesWithInspectVars,
    getInspectVar,
    setInspectVar,
    deleteAllInspectVars: deleteAllInspectVarsInStore,
    deleteNodeInspectVars: deleteNodeInspectVarsInStore,
    getLastRunVar,
  } = workflowStore.getState()

  // rag flow don't have start node
  const startNode = nodesWithInspectVars.find(node => node.nodeType === BlockEnum.Start)
  const systemVars = startNode?.vars.filter(varItem => varItem.selector[0] === 'sys')

  const fetchInspectVarValue = (selector: ValueSelector) => {
    const nodeId = selector[0]
    const isSystemVar = selector[1] === 'sys'
    const isConversationVar = selector[1] === 'conversation'
    console.log(nodeId, isSystemVar, isConversationVar)
    // fetch values under nodeId. system var and conversation var has different fetch method
  }

  const editInspectVarValue = (varId: string, value: any) => {
    console.log('edit var', varId, value)
    // call api and update store
  }

  const editInspectVarSelector = (varId: string, selector: ValueSelector) => {
    console.log('edit var selector', varId, selector)
    // call api and update store
  }

  const editInspectVarValueType = (varId: string, valueType: VarType) => {
    console.log('edit var value type', varId, valueType)
  }

  const deleteInspectVar = async (varId: string) => {
    console.log('delete var', varId)
  }

  const deleteNodeInspectorVars = async (nodeId: string) => {
    // todo fetch api
    deleteNodeInspectVarsInStore(nodeId)
  }

  const deleteAllInspectorVars = async () => {
    // todo fetch api
    deleteAllInspectVarsInStore()
  }

  const isInspectVarEdited = (nodeId: string, key: string) => {
    return getInspectVar(nodeId, key) !== getLastRunVar(nodeId, key)
  }

  const resetToLastRunVar = (nodeId: string, key: string) => {
    const lastRunVar = getLastRunVar(nodeId, key)
    if (lastRunVar)
      setInspectVar(nodeId, key, lastRunVar)
  }

  return {
    conversationVars,
    systemVars,
    nodesWithInspectVars,
    fetchInspectVarValue,
    editInspectVarValue,
    editInspectVarSelector,
    editInspectVarValueType,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
  }
}

export default useCurrentVars

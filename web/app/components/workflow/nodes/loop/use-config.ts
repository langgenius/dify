import type { ErrorHandleMode, Var } from '../../types'
import type {
  HandleAddCondition,
  HandleAddSubVariableCondition,
  HandleRemoveCondition,
  HandleToggleConditionLogicalOperator,
  HandleToggleSubVariableConditionLogicalOperator,
  HandleUpdateCondition,
  HandleUpdateSubVariableCondition,
  LoopNodeType,
} from './types'
import {
  useCallback,
  useRef,
} from 'react'
import { useStore } from '@/app/components/workflow/store'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import { toNodeOutputVars } from '../_base/components/variable/utils'
import useNodeCrud from '../_base/hooks/use-node-crud'
import {
  addBreakCondition,
  addLoopVariable,
  addSubVariableCondition,
  canUseAsLoopInput,
  removeBreakCondition,
  removeLoopVariable,
  removeSubVariableCondition,
  toggleConditionOperator,
  toggleSubVariableConditionOperator,
  updateBreakCondition,
  updateErrorHandleMode,
  updateLoopCount,
  updateLoopVariable,
  updateSubVariableCondition,
} from './use-config.helpers'
import useIsVarFileAttribute from './use-is-var-file-attribute'

const useConfig = (id: string, payload: LoopNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const conversationVariables = useStore(s => s.conversationVariables)

  const { inputs, setInputs } = useNodeCrud<LoopNodeType>(id, payload)
  const inputsRef = useRef(inputs)
  const handleInputsChange = useCallback((newInputs: LoopNodeType) => {
    inputsRef.current = newInputs
    setInputs(newInputs)
  }, [setInputs])

  const filterInputVar = useCallback((varPayload: Var) => canUseAsLoopInput(varPayload), [])

  // output
  const { getLoopNodeChildren } = useWorkflow()
  const loopChildrenNodes = [{ id, data: payload } as any, ...getLoopNodeChildren(id)]
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  const allPluginInfoList = {
    buildInTools: buildInTools || [],
    customTools: customTools || [],
    workflowTools: workflowTools || [],
    mcpTools: mcpTools || [],
    dataSourceList: dataSourceList || [],
  }
  const childrenNodeVars = toNodeOutputVars(loopChildrenNodes, isChatMode, undefined, [], conversationVariables, [], allPluginInfoList)

  const {
    getIsVarFileAttribute,
  } = useIsVarFileAttribute({
    nodeId: id,
  })

  const changeErrorResponseMode = useCallback((item: { value: unknown }) => {
    handleInputsChange(updateErrorHandleMode(inputsRef.current, item.value as ErrorHandleMode))
  }, [handleInputsChange])

  const handleAddCondition = useCallback<HandleAddCondition>((valueSelector, varItem) => {
    handleInputsChange(addBreakCondition({
      inputs: inputsRef.current,
      valueSelector,
      variable: varItem,
      isVarFileAttribute: !!getIsVarFileAttribute(valueSelector),
    }))
  }, [getIsVarFileAttribute, handleInputsChange])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((conditionId) => {
    handleInputsChange(removeBreakCondition(inputsRef.current, conditionId))
  }, [handleInputsChange])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((conditionId, newCondition) => {
    handleInputsChange(updateBreakCondition(inputsRef.current, conditionId, newCondition))
  }, [handleInputsChange])

  const handleToggleConditionLogicalOperator = useCallback<HandleToggleConditionLogicalOperator>(() => {
    handleInputsChange(toggleConditionOperator(inputsRef.current))
  }, [handleInputsChange])

  const handleAddSubVariableCondition = useCallback<HandleAddSubVariableCondition>((conditionId: string, key?: string) => {
    handleInputsChange(addSubVariableCondition(inputsRef.current, conditionId, key))
  }, [handleInputsChange])

  const handleRemoveSubVariableCondition = useCallback((conditionId: string, subConditionId: string) => {
    handleInputsChange(removeSubVariableCondition(inputsRef.current, conditionId, subConditionId))
  }, [handleInputsChange])

  const handleUpdateSubVariableCondition = useCallback<HandleUpdateSubVariableCondition>((conditionId, subConditionId, newSubCondition) => {
    handleInputsChange(updateSubVariableCondition(inputsRef.current, conditionId, subConditionId, newSubCondition))
  }, [handleInputsChange])

  const handleToggleSubVariableConditionLogicalOperator = useCallback<HandleToggleSubVariableConditionLogicalOperator>((conditionId) => {
    handleInputsChange(toggleSubVariableConditionOperator(inputsRef.current, conditionId))
  }, [handleInputsChange])

  const handleUpdateLoopCount = useCallback((value: number) => {
    handleInputsChange(updateLoopCount(inputsRef.current, value))
  }, [handleInputsChange])

  const handleAddLoopVariable = useCallback(() => {
    handleInputsChange(addLoopVariable(inputsRef.current))
  }, [handleInputsChange])

  const handleRemoveLoopVariable = useCallback((id: string) => {
    handleInputsChange(removeLoopVariable(inputsRef.current, id))
  }, [handleInputsChange])

  const handleUpdateLoopVariable = useCallback((id: string, updateData: any) => {
    handleInputsChange(updateLoopVariable(inputsRef.current, id, updateData))
  }, [handleInputsChange])

  return {
    readOnly,
    inputs,
    filterInputVar,
    childrenNodeVars,
    loopChildrenNodes,
    handleAddCondition,
    handleRemoveCondition,
    handleUpdateCondition,
    handleToggleConditionLogicalOperator,
    handleAddSubVariableCondition,
    handleUpdateSubVariableCondition,
    handleRemoveSubVariableCondition,
    handleToggleSubVariableConditionLogicalOperator,
    handleUpdateLoopCount,
    changeErrorResponseMode,
    handleAddLoopVariable,
    handleRemoveLoopVariable,
    handleUpdateLoopVariable,
  }
}

export default useConfig

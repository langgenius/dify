import type {
  Var,
} from '../../types'
import type {
  CaseItem,
  HandleAddCondition,
  HandleAddSubVariableCondition,
  HandleRemoveCondition,
  HandleToggleConditionLogicalOperator,
  HandleToggleSubVariableConditionLogicalOperator,
  HandleUpdateCondition,
  HandleUpdateSubVariableCondition,
  IfElseNodeType,
} from './types'
import {
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import {
  useEdgesInteractions,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  addCase,
  addCondition,
  addSubVariableCondition,
  filterAllVars,
  filterNumberVars,
  getVarsIsVarFileAttribute,
  removeCase,
  removeCondition,
  removeSubVariableCondition,
  sortCases,
  toggleConditionLogicalOperator,
  toggleSubVariableConditionLogicalOperator,
  updateCondition,
  updateSubVariableCondition,
} from './use-config.helpers'
import useIsVarFileAttribute from './use-is-var-file-attribute'

const useConfig = (id: string, payload: IfElseNodeType) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()
  const { inputs, setInputs } = useNodeCrud<IfElseNodeType>(id, payload)
  const inputsRef = useRef(inputs)
  const handleInputsChange = useCallback((newInputs: IfElseNodeType) => {
    inputsRef.current = newInputs
    setInputs(newInputs)
  }, [setInputs])

  const filterVar = useCallback(() => filterAllVars(), [])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const filterNumberVar = useCallback((varPayload: Var) => filterNumberVars(varPayload), [])

  const {
    getIsVarFileAttribute,
  } = useIsVarFileAttribute({
    nodeId: id,
    isInIteration: payload.isInIteration,
    isInLoop: payload.isInLoop,
  })

  const varsIsVarFileAttribute = useMemo(() => {
    return getVarsIsVarFileAttribute(inputs.cases, getIsVarFileAttribute)
  }, [inputs.cases, getIsVarFileAttribute])

  const {
    availableVars: availableNumberVars,
    availableNodesWithParent: availableNumberNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterNumberVar,
  })

  const handleAddCase = useCallback(() => {
    handleInputsChange(addCase(inputsRef.current))
  }, [handleInputsChange])

  const handleRemoveCase = useCallback((caseId: string) => {
    handleEdgeDeleteByDeleteBranch(id, caseId)
    handleInputsChange(removeCase(inputsRef.current, caseId))
  }, [handleEdgeDeleteByDeleteBranch, handleInputsChange, id])

  const handleSortCase = useCallback((newCases: (CaseItem & { id: string })[]) => {
    handleInputsChange(sortCases(inputsRef.current, newCases))
    updateNodeInternals(id)
  }, [handleInputsChange, id, updateNodeInternals])

  const handleAddCondition = useCallback<HandleAddCondition>((caseId, valueSelector, varItem) => {
    handleInputsChange(addCondition({
      inputs: inputsRef.current,
      caseId,
      valueSelector,
      variable: varItem,
      isVarFileAttribute: !!getIsVarFileAttribute(valueSelector),
    }))
  }, [getIsVarFileAttribute, handleInputsChange])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((caseId, conditionId) => {
    handleInputsChange(removeCondition(inputsRef.current, caseId, conditionId))
  }, [handleInputsChange])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((caseId, conditionId, newCondition) => {
    handleInputsChange(updateCondition(inputsRef.current, caseId, conditionId, newCondition))
  }, [handleInputsChange])

  const handleToggleConditionLogicalOperator = useCallback<HandleToggleConditionLogicalOperator>((caseId) => {
    handleInputsChange(toggleConditionLogicalOperator(inputsRef.current, caseId))
  }, [handleInputsChange])

  const handleAddSubVariableCondition = useCallback<HandleAddSubVariableCondition>((caseId: string, conditionId: string, key?: string) => {
    handleInputsChange(addSubVariableCondition(inputsRef.current, caseId, conditionId, key))
  }, [handleInputsChange])

  const handleRemoveSubVariableCondition = useCallback((caseId: string, conditionId: string, subConditionId: string) => {
    handleInputsChange(removeSubVariableCondition(inputsRef.current, caseId, conditionId, subConditionId))
  }, [handleInputsChange])

  const handleUpdateSubVariableCondition = useCallback<HandleUpdateSubVariableCondition>((caseId, conditionId, subConditionId, newSubCondition) => {
    handleInputsChange(updateSubVariableCondition(inputsRef.current, caseId, conditionId, subConditionId, newSubCondition))
  }, [handleInputsChange])

  const handleToggleSubVariableConditionLogicalOperator = useCallback<HandleToggleSubVariableConditionLogicalOperator>((caseId, conditionId) => {
    handleInputsChange(toggleSubVariableConditionLogicalOperator(inputsRef.current, caseId, conditionId))
  }, [handleInputsChange])

  return {
    readOnly,
    inputs,
    filterVar,
    filterNumberVar,
    handleAddCase,
    handleRemoveCase,
    handleSortCase,
    handleAddCondition,
    handleRemoveCondition,
    handleUpdateCondition,
    handleToggleConditionLogicalOperator,
    handleAddSubVariableCondition,
    handleUpdateSubVariableCondition,
    handleRemoveSubVariableCondition,
    handleToggleSubVariableConditionLogicalOperator,
    nodesOutputVars: availableVars,
    availableNodes: availableNodesWithParent,
    nodesOutputNumberVars: availableNumberVars,
    availableNumberNodes: availableNumberNodesWithParent,
    varsIsVarFileAttribute,
  }
}

export default useConfig

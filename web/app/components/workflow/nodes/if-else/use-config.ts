import { useCallback, useMemo } from 'react'
import produce from 'immer'
import { v4 as uuid4 } from 'uuid'
import { useUpdateNodeInternals } from 'reactflow'
import type {
  Var,
} from '../../types'
import { VarType } from '../../types'
import { LogicalOperator } from './types'
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
  branchNameCorrect,
  getOperators,
} from './utils'
import useIsVarFileAttribute from './use-is-var-file-attribute'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useEdgesInteractions,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'

const useConfig = (id: string, payload: IfElseNodeType) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()
  const { inputs, setInputs } = useNodeCrud<IfElseNodeType>(id, payload)

  const filterVar = useCallback(() => {
    return true
  }, [])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const filterNumberVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.number
  }, [])

  const {
    getIsVarFileAttribute,
  } = useIsVarFileAttribute({
    nodeId: id,
    isInIteration: payload.isInIteration,
  })

  const varsIsVarFileAttribute = useMemo(() => {
    const conditions: Record<string, boolean> = {}
    inputs.cases?.forEach((c) => {
      c.conditions.forEach((condition) => {
        conditions[condition.id] = getIsVarFileAttribute(condition.variable_selector!)
      })
    })
    return conditions
  }, [inputs.cases, getIsVarFileAttribute])

  const {
    availableVars: availableNumberVars,
    availableNodesWithParent: availableNumberNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterNumberVar,
  })

  const handleAddCase = useCallback(() => {
    const newInputs = produce(inputs, () => {
      if (inputs.cases) {
        const case_id = uuid4()
        inputs.cases.push({
          case_id,
          logical_operator: LogicalOperator.and,
          conditions: [],
        })
        if (inputs._targetBranches) {
          const elseCaseIndex = inputs._targetBranches.findIndex(branch => branch.id === 'false')
          if (elseCaseIndex > -1) {
            inputs._targetBranches = branchNameCorrect([
              ...inputs._targetBranches.slice(0, elseCaseIndex),
              {
                id: case_id,
                name: '',
              },
              ...inputs._targetBranches.slice(elseCaseIndex),
            ])
          }
        }
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRemoveCase = useCallback((caseId: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.cases = draft.cases?.filter(item => item.case_id !== caseId)

      if (draft._targetBranches)
        draft._targetBranches = branchNameCorrect(draft._targetBranches.filter(branch => branch.id !== caseId))

      handleEdgeDeleteByDeleteBranch(id, caseId)
    })
    setInputs(newInputs)
  }, [inputs, setInputs, id, handleEdgeDeleteByDeleteBranch])

  const handleSortCase = useCallback((newCases: (CaseItem & { id: string })[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.cases = newCases.filter(Boolean).map(item => ({
        id: item.id,
        case_id: item.case_id,
        logical_operator: item.logical_operator,
        conditions: item.conditions,
      }))

      draft._targetBranches = branchNameCorrect([
        ...newCases.filter(Boolean).map(item => ({ id: item.case_id, name: '' })),
        { id: 'false', name: '' },
      ])
    })
    setInputs(newInputs)
    updateNodeInternals(id)
  }, [inputs, setInputs])

  const handleAddCondition = useCallback<HandleAddCondition>((caseId, valueSelector, varItem) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.case_id === caseId)
      if (targetCase) {
        targetCase.conditions.push({
          id: uuid4(),
          varType: varItem.type,
          variable_selector: valueSelector,
          comparison_operator: getOperators(varItem.type, getIsVarFileAttribute(valueSelector) ? { key: valueSelector.slice(-1)[0] } : undefined)[0],
          value: '',
        })
      }
    })
    setInputs(newInputs)
  }, [getIsVarFileAttribute, inputs, setInputs])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((caseId, conditionId) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.case_id === caseId)
      if (targetCase)
        targetCase.conditions = targetCase.conditions.filter(item => item.id !== conditionId)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((caseId, conditionId, newCondition) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.case_id === caseId)
      if (targetCase) {
        const targetCondition = targetCase.conditions.find(item => item.id === conditionId)
        if (targetCondition)
          Object.assign(targetCondition, newCondition)
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleToggleConditionLogicalOperator = useCallback<HandleToggleConditionLogicalOperator>((caseId) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.case_id === caseId)
      if (targetCase)
        targetCase.logical_operator = targetCase.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddSubVariableCondition = useCallback<HandleAddSubVariableCondition>((caseId: string, conditionId: string, key?: string) => {
    const newInputs = produce(inputs, (draft) => {
      const condition = draft.cases?.find(item => item.case_id === caseId)?.conditions.find(item => item.id === conditionId)
      if (!condition)
        return
      if (!condition?.sub_variable_condition) {
        condition.sub_variable_condition = {
          case_id: uuid4(),
          logical_operator: LogicalOperator.and,
          conditions: [],
        }
      }
      const subVarCondition = condition.sub_variable_condition
      if (subVarCondition) {
        if (!subVarCondition.conditions)
          subVarCondition.conditions = []

        subVarCondition.conditions.push({
          id: uuid4(),
          key: key || '',
          varType: VarType.string,
          comparison_operator: undefined,
          value: '',
        })
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRemoveSubVariableCondition = useCallback((caseId: string, conditionId: string, subConditionId: string) => {
    const newInputs = produce(inputs, (draft) => {
      const condition = draft.cases?.find(item => item.case_id === caseId)?.conditions.find(item => item.id === conditionId)
      if (!condition)
        return
      if (!condition?.sub_variable_condition)
        return
      const subVarCondition = condition.sub_variable_condition
      if (subVarCondition)
        subVarCondition.conditions = subVarCondition.conditions.filter(item => item.id !== subConditionId)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleUpdateSubVariableCondition = useCallback<HandleUpdateSubVariableCondition>((caseId, conditionId, subConditionId, newSubCondition) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.case_id === caseId)
      if (targetCase) {
        const targetCondition = targetCase.conditions.find(item => item.id === conditionId)
        if (targetCondition && targetCondition.sub_variable_condition) {
          const targetSubCondition = targetCondition.sub_variable_condition.conditions.find(item => item.id === subConditionId)
          if (targetSubCondition)
            Object.assign(targetSubCondition, newSubCondition)
        }
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleToggleSubVariableConditionLogicalOperator = useCallback<HandleToggleSubVariableConditionLogicalOperator>((caseId, conditionId) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.case_id === caseId)
      if (targetCase) {
        const targetCondition = targetCase.conditions.find(item => item.id === conditionId)
        if (targetCondition && targetCondition.sub_variable_condition)
          targetCondition.sub_variable_condition.logical_operator = targetCondition.sub_variable_condition.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

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

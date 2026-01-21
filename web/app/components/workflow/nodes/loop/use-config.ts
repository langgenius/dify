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
import { produce } from 'immer'
import {
  useCallback,
  useRef,
} from 'react'
import { v4 as uuid4 } from 'uuid'
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
import { ValueType, VarType } from '../../types'
import { toNodeOutputVars } from '../_base/components/variable/utils'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { LogicalOperator } from './types'
import useIsVarFileAttribute from './use-is-var-file-attribute'
import { getOperators } from './utils'

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

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject, VarType.arrayFile].includes(varPayload.type)
  }, [])

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
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.error_handle_mode = item.value as ErrorHandleMode
    })
    handleInputsChange(newInputs)
  }, [inputs, handleInputsChange])

  const handleAddCondition = useCallback<HandleAddCondition>((valueSelector, varItem) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      if (!draft.break_conditions)
        draft.break_conditions = []

      draft.break_conditions?.push({
        id: uuid4(),
        varType: varItem.type,
        variable_selector: valueSelector,
        comparison_operator: getOperators(varItem.type, getIsVarFileAttribute(valueSelector) ? { key: valueSelector.slice(-1)[0] } : undefined)[0],
        value: varItem.type === VarType.boolean ? 'false' : '',
      })
    })
    handleInputsChange(newInputs)
  }, [getIsVarFileAttribute, handleInputsChange])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((conditionId) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.break_conditions = draft.break_conditions?.filter(item => item.id !== conditionId)
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((conditionId, newCondition) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      const targetCondition = draft.break_conditions?.find(item => item.id === conditionId)
      if (targetCondition)
        Object.assign(targetCondition, newCondition)
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleToggleConditionLogicalOperator = useCallback<HandleToggleConditionLogicalOperator>(() => {
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.logical_operator = draft.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleAddSubVariableCondition = useCallback<HandleAddSubVariableCondition>((conditionId: string, key?: string) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      const condition = draft.break_conditions?.find(item => item.id === conditionId)
      if (!condition)
        return
      if (!condition?.sub_variable_condition) {
        condition.sub_variable_condition = {
          logical_operator: LogicalOperator.and,
          conditions: [],
        }
      }
      const subVarCondition = condition.sub_variable_condition
      if (subVarCondition) {
        if (!subVarCondition.conditions)
          subVarCondition.conditions = []

        const svcComparisonOperators = getOperators(VarType.string, { key: key || '' })

        subVarCondition.conditions.push({
          id: uuid4(),
          key: key || '',
          varType: VarType.string,
          comparison_operator: (svcComparisonOperators && svcComparisonOperators.length) ? svcComparisonOperators[0] : undefined,
          value: '',
        })
      }
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleRemoveSubVariableCondition = useCallback((conditionId: string, subConditionId: string) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      const condition = draft.break_conditions?.find(item => item.id === conditionId)
      if (!condition)
        return
      if (!condition?.sub_variable_condition)
        return
      const subVarCondition = condition.sub_variable_condition
      if (subVarCondition)
        subVarCondition.conditions = subVarCondition.conditions.filter(item => item.id !== subConditionId)
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleUpdateSubVariableCondition = useCallback<HandleUpdateSubVariableCondition>((conditionId, subConditionId, newSubCondition) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      const targetCondition = draft.break_conditions?.find(item => item.id === conditionId)
      if (targetCondition && targetCondition.sub_variable_condition) {
        const targetSubCondition = targetCondition.sub_variable_condition.conditions.find(item => item.id === subConditionId)
        if (targetSubCondition)
          Object.assign(targetSubCondition, newSubCondition)
      }
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleToggleSubVariableConditionLogicalOperator = useCallback<HandleToggleSubVariableConditionLogicalOperator>((conditionId) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      const targetCondition = draft.break_conditions?.find(item => item.id === conditionId)
      if (targetCondition && targetCondition.sub_variable_condition)
        targetCondition.sub_variable_condition.logical_operator = targetCondition.sub_variable_condition.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleUpdateLoopCount = useCallback((value: number) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.loop_count = value
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleAddLoopVariable = useCallback(() => {
    const newInputs = produce(inputsRef.current, (draft) => {
      if (!draft.loop_variables)
        draft.loop_variables = []

      draft.loop_variables.push({
        id: uuid4(),
        label: '',
        var_type: VarType.string,
        value_type: ValueType.constant,
        value: '',
      })
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleRemoveLoopVariable = useCallback((id: string) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.loop_variables = draft.loop_variables?.filter(item => item.id !== id)
    })
    handleInputsChange(newInputs)
  }, [handleInputsChange])

  const handleUpdateLoopVariable = useCallback((id: string, updateData: any) => {
    const loopVariables = inputsRef.current.loop_variables || []
    const index = loopVariables.findIndex(item => item.id === id)
    const newInputs = produce(inputsRef.current, (draft) => {
      if (index > -1) {
        draft.loop_variables![index] = {
          ...draft.loop_variables![index],
          ...updateData,
        }
      }
    })
    handleInputsChange(newInputs)
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

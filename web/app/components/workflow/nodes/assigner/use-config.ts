import { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { isEqual } from 'lodash-es'
import { VarType } from '../../types'
import type { ValueSelector, Var } from '../../types'
import { type AssignerNodeType, WriteMode } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: AssignerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const store = useStoreApi()
  const { getBeforeNodesInSameBranch } = useWorkflow()

  const {
    getNodes,
  } = store.getState()
  const currentNode = getNodes().find(n => n.id === id)
  const isInIteration = payload.isInIteration
  const iterationNode = isInIteration ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(id)
  }, [getBeforeNodesInSameBranch, id])
  const { inputs, setInputs } = useNodeCrud<AssignerNodeType>(id, payload)

  const { getCurrentVariableType } = useWorkflowVariables()
  const assignedVarType = getCurrentVariableType({
    parentNode: iterationNode,
    valueSelector: inputs.assigned_variable_selector || [],
    availableNodes,
    isChatMode,
    isConstant: false,
  })

  const isSupportAppend = useCallback((varType: VarType) => {
    return [VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varType)
  }, [])

  const isCurrSupportAppend = useMemo(() => isSupportAppend(assignedVarType), [assignedVarType, isSupportAppend])

  const handleAssignedVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.assigned_variable_selector = variable as ValueSelector
      draft.input_variable_selector = []

      const newVarType = getCurrentVariableType({
        parentNode: iterationNode,
        valueSelector: draft.assigned_variable_selector || [],
        availableNodes,
        isChatMode,
        isConstant: false,
      })

      if (inputs.write_mode === WriteMode.Append && !isSupportAppend(newVarType))
        draft.write_mode = WriteMode.Overwrite
    })
    setInputs(newInputs)
  }, [inputs, setInputs, getCurrentVariableType, iterationNode, availableNodes, isChatMode, isSupportAppend])

  const writeModeTypes = [WriteMode.Overwrite, WriteMode.Append, WriteMode.Clear]

  const handleWriteModeChange = useCallback((writeMode: WriteMode) => {
    return () => {
      const newInputs = produce(inputs, (draft) => {
        draft.write_mode = writeMode
        if (inputs.write_mode === WriteMode.Clear)
          draft.input_variable_selector = []
      })
      setInputs(newInputs)
    }
  }, [inputs, setInputs])

  const toAssignedVarType = useMemo(() => {
    const { write_mode } = inputs
    if (write_mode === WriteMode.Overwrite)
      return assignedVarType
    if (write_mode === WriteMode.Append) {
      if (assignedVarType === VarType.arrayString)
        return VarType.string
      if (assignedVarType === VarType.arrayNumber)
        return VarType.number
      if (assignedVarType === VarType.arrayObject)
        return VarType.object
    }
    return VarType.string
  }, [assignedVarType, inputs])

  const filterAssignedVar = useCallback((varPayload: Var, selector: ValueSelector) => {
    return selector.join('.').startsWith('conversation')
  }, [])

  const filterToAssignedVar = useCallback((varPayload: Var, selector: ValueSelector) => {
    if (isEqual(selector, inputs.assigned_variable_selector))
      return false

    if (inputs.write_mode === WriteMode.Overwrite) {
      return varPayload.type === assignedVarType
    }
    else if (inputs.write_mode === WriteMode.Append) {
      switch (assignedVarType) {
        case VarType.arrayString:
          return varPayload.type === VarType.string
        case VarType.arrayNumber:
          return varPayload.type === VarType.number
        case VarType.arrayObject:
          return varPayload.type === VarType.object
        default:
          return false
      }
    }
    return true
  }, [inputs.assigned_variable_selector, inputs.write_mode, assignedVarType])

  const handleToAssignedVarChange = useCallback((value: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.input_variable_selector = value as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    handleAssignedVarChanges,
    assignedVarType,
    isSupportAppend: isCurrSupportAppend,
    writeModeTypes,
    handleWriteModeChange,
    filterAssignedVar,
    filterToAssignedVar,
    handleToAssignedVarChange,
    toAssignedVarType,
  }
}

export default useConfig

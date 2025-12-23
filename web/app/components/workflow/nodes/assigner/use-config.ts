import type { ValueSelector, Var } from '../../types'
import type { AssignerNodeOperation, AssignerNodeType } from './types'
import { produce } from 'immer'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { VarType } from '../../types'
import { useGetAvailableVars } from './hooks'
import { WriteMode, writeModeTypesNum } from './types'
import { convertV1ToV2 } from './utils'

const useConfig = (id: string, rawPayload: AssignerNodeType) => {
  const payload = useMemo(() => convertV1ToV2(rawPayload), [rawPayload])
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const getAvailableVars = useGetAvailableVars()
  const filterVar = (varType: VarType) => {
    return (v: Var) => {
      if (varType === VarType.any)
        return true
      if (v.type === VarType.any)
        return true
      return v.type === varType
    }
  }

  const store = useStoreApi()
  const { getBeforeNodesInSameBranchIncludeParent } = useWorkflow()

  const {
    getNodes,
  } = store.getState()
  const currentNode = getNodes().find(n => n.id === id)
  const isInIteration = payload.isInIteration
  const iterationNode = isInIteration ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranchIncludeParent(id)
  }, [getBeforeNodesInSameBranchIncludeParent, id])
  const { inputs, setInputs } = useNodeCrud<AssignerNodeType>(id, payload)
  const newSetInputs = useCallback((newInputs: AssignerNodeType) => {
    const finalInputs = produce(newInputs, (draft) => {
      if (draft.version !== '2')
        draft.version = '2'
    })
    setInputs(finalInputs)
  }, [setInputs])

  const { getCurrentVariableType } = useWorkflowVariables()
  const getAssignedVarType = useCallback((valueSelector: ValueSelector) => {
    return getCurrentVariableType({
      parentNode: isInIteration ? iterationNode : null,
      valueSelector: valueSelector || [],
      availableNodes,
      isChatMode,
      isConstant: false,
    })
  }, [getCurrentVariableType, isInIteration, iterationNode, availableNodes, isChatMode])

  const handleOperationListChanges = useCallback((items: AssignerNodeOperation[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.items = [...items]
    })
    newSetInputs(newInputs)
  }, [inputs, newSetInputs])

  const writeModeTypesArr = [WriteMode.overwrite, WriteMode.clear, WriteMode.append, WriteMode.extend, WriteMode.removeFirst, WriteMode.removeLast]
  const writeModeTypes = [WriteMode.overwrite, WriteMode.clear, WriteMode.set]

  const getToAssignedVarType = useCallback((assignedVarType: VarType, write_mode: WriteMode) => {
    if (write_mode === WriteMode.overwrite || write_mode === WriteMode.increment || write_mode === WriteMode.decrement
      || write_mode === WriteMode.multiply || write_mode === WriteMode.divide || write_mode === WriteMode.extend) {
      return assignedVarType
    }
    if (write_mode === WriteMode.append) {
      if (assignedVarType === VarType.arrayString)
        return VarType.string
      if (assignedVarType === VarType.arrayNumber)
        return VarType.number
      if (assignedVarType === VarType.arrayObject)
        return VarType.object
    }
    return VarType.string
  }, [])

  const filterAssignedVar = useCallback((varPayload: Var, selector: ValueSelector) => {
    if (varPayload.isLoopVariable)
      return true
    return selector.join('.').startsWith('conversation')
  }, [])

  const filterToAssignedVar = useCallback((varPayload: Var, assignedVarType: VarType, write_mode: WriteMode) => {
    if (write_mode === WriteMode.overwrite || write_mode === WriteMode.extend || write_mode === WriteMode.increment
      || write_mode === WriteMode.decrement || write_mode === WriteMode.multiply || write_mode === WriteMode.divide) {
      return varPayload.type === assignedVarType
    }
    else if (write_mode === WriteMode.append) {
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
  }, [])

  return {
    readOnly,
    inputs,
    handleOperationListChanges,
    getAssignedVarType,
    getToAssignedVarType,
    writeModeTypes,
    writeModeTypesArr,
    writeModeTypesNum,
    filterAssignedVar,
    filterToAssignedVar,
    getAvailableVars,
    filterVar,
  }
}

export default useConfig

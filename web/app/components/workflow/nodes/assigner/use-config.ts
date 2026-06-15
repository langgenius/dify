import type { ValueSelector, Var } from '../../types'
import type { AssignerNodeOperation, AssignerNodeType } from './types'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useGetAvailableVars } from './hooks'
import { WriteMode, writeModeTypesNum } from './types'
import {
  canAssignToVar,
  canAssignVar,
  ensureAssignerVersion,
  filterVarByType,
  normalizeAssignedVarType,
  updateOperationItems,
} from './use-config.helpers'
import { convertV1ToV2 } from './utils'

const useConfig = (id: string, rawPayload: AssignerNodeType) => {
  const payload = useMemo(() => convertV1ToV2(rawPayload), [rawPayload])
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const getAvailableVars = useGetAvailableVars()

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
    setInputs(ensureAssignerVersion(newInputs))
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
    newSetInputs(updateOperationItems(inputs, items))
  }, [inputs, newSetInputs])

  const writeModeTypesArr = [WriteMode.overwrite, WriteMode.clear, WriteMode.append, WriteMode.extend, WriteMode.removeFirst, WriteMode.removeLast]
  const writeModeTypes = [WriteMode.overwrite, WriteMode.clear, WriteMode.set]

  const getToAssignedVarType = useCallback(normalizeAssignedVarType, [])

  const filterAssignedVar = useCallback((varPayload: Var, selector: ValueSelector) => {
    if (varPayload.isLoopVariable)
      return true
    return canAssignVar(varPayload, selector)
  }, [])

  const filterToAssignedVar = useCallback(canAssignToVar, [])

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
    filterVar: filterVarByType,
  }
}

export default useConfig

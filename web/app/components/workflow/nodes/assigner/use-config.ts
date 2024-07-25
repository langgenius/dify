import { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { type ValueSelector, VarType } from '../../types'
import { type AssignerNodeType, WriteMode } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

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
  const varType = getCurrentVariableType({
    parentNode: iterationNode,
    valueSelector: inputs.variable || [],
    availableNodes,
    isChatMode,
    isConstant: false,
  })

  const getInitValue = useCallback((varType: VarType, writeMode: WriteMode) => {
    switch (varType) {
      case VarType.string:
        return ''
      case VarType.number:
        return {
          type: VarKindType.constant,
          value: undefined,
        }
      case VarType.object:
        return [
          {
            id: Date.now(),
            key: '',
            value: '',
          },
        ]
      case VarType.arrayFile:
        return []
      case VarType.arrayString:
      case VarType.arrayNumber:
      case VarType.arrayObject:
        if (writeMode === WriteMode.Append) {
          switch (varType) {
            case VarType.arrayString:
              return ''
            case VarType.arrayNumber:
              return {
                type: VarKindType.constant,
                value: 0,
              }
            case VarType.arrayObject:
              return [
                {
                  id: Date.now(),
                  key: '',
                  value: '',
                },
              ]
          }
        }
        else {
          return {
            type: VarKindType.constant,
            value: '',
          }
        }
    }
  }, [])

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable = variable as ValueSelector
      const newVarType = getCurrentVariableType({
        parentNode: iterationNode,
        valueSelector: draft.variable || [],
        availableNodes,
        isChatMode,
        isConstant: false,
      })
      draft.varType = newVarType
      if (newVarType !== varType)
        draft.value = getInitValue(newVarType, inputs.writeMode)
    })
    setInputs(newInputs)
  }, [availableNodes, getCurrentVariableType, getInitValue, inputs, isChatMode, iterationNode, setInputs, varType])

  const writeModeTypes = useMemo(() => {
    const types = [WriteMode.Overwrite, WriteMode.Append, WriteMode.Clear]
    if (varType === VarType.object)
      return types.filter(t => t !== WriteMode.Append)

    return types
  }, [varType])

  const handleWriteModeChange = useCallback((writeMode: WriteMode) => {
    return () => {
      const newInputs = produce(inputs, (draft) => {
        draft.writeMode = writeMode
        if (inputs.writeMode !== WriteMode.Clear && writeMode !== WriteMode.Clear && varType !== VarType.string && varType !== VarType.number)
          draft.value = getInitValue(varType, writeMode)
      })
      setInputs(newInputs)
    }
  }, [getInitValue, inputs, setInputs, varType])

  const handleValueChange = useCallback((value: any) => {
    const newInputs = produce(inputs, (draft) => {
      draft.value = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback(() => {
    return true // [VarType.string, VarType.number, VarType.object, VarType.array, VarType.arrayNumber, VarType.arrayString, VarType.arrayObject].includes(varPayload.type)
  }, [])

  return {
    readOnly,
    inputs,
    filterVar,
    handleVarChanges,
    varType,
    writeModeTypes,
    handleWriteModeChange,
    handleValueChange,
  }
}

export default useConfig

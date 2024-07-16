import { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { type ValueSelector, VarType } from '../../types'
import { getVarType } from '../_base/components/variable/utils'
import { type AssignerNodeType, WriteMode } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
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

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable = variable as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const varType = getVarType({
    parentNode: iterationNode,
    valueSelector: inputs.variable,
    availableNodes,
    isChatMode,
    isConstant: false,
  })

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
      })
      setInputs(newInputs)
    }
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
  }
}

export default useConfig

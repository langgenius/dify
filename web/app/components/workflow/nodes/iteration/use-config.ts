import { useCallback } from 'react'
import produce from 'immer'
import {
  useNodesReadOnly,
} from '../../hooks'
import { VarType } from '../../types'
import type { ValueSelector, Var } from '../../types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import type { IterationNodeType } from './types'

const useConfig = (id: string, payload: IterationNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const { inputs, setInputs } = useNodeCrud<IterationNodeType>(id, payload)

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varPayload.type)
  }, [])

  const handleInputChange = useCallback((input: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.iterator_selector = input as ValueSelector || []
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterInputVar,
    handleInputChange,
  }
}

export default useConfig

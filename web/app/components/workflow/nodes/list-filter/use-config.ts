import { useCallback } from 'react'
import produce from 'immer'
import type { ValueSelector, Var } from '../../types'
import { VarType } from '../../types'
import type { Limit, ListFilterNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: ListFilterNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const { inputs, setInputs } = useNodeCrud<ListFilterNodeType>(id, payload)

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable = variable as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.arrayNumber, VarType.arrayString, VarType.arrayFile, VarType.arrayObject].includes(varPayload.type)
  }, [])

  const handleLimitChange = useCallback((limit: Limit) => {
    const newInputs = produce(inputs, (draft) => {
      draft.limit = limit
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterVar,
    handleVarChanges,
    handleLimitChange,
  }
}

export default useConfig

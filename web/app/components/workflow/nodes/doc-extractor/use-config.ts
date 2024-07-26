import { useCallback } from 'react'
import produce from 'immer'
import type { ValueSelector, Var } from '../../types'
import { VarType } from '../../types'
import { type DocExtractorNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: DocExtractorNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const { inputs, setInputs } = useNodeCrud<DocExtractorNodeType>(id, payload)

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable = variable as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type !== VarType.file
  }, [])

  return {
    readOnly,
    inputs,
    filterVar,
    handleVarChanges,
  }
}

export default useConfig

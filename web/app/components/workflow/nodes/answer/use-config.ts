import type { Var } from '../../types'
import type { AnswerNodeType } from './types'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { VarType } from '../../types'
import useVarList from '../_base/hooks/use-var-list'

const useConfig = (id: string, payload: AnswerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<AnswerNodeType>(id, payload)
  // variables
  const { handleVarListChange, handleAddVariable } = useVarList<AnswerNodeType>({
    inputs,
    setInputs,
  })

  const handleAnswerChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.answer = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type !== VarType.arrayObject
  }, [])
  return {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleAnswerChange,
    filterVar,
  }
}

export default useConfig

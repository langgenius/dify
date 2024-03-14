import { useCallback } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import type { AnswerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

const useConfig = (id: string, payload: AnswerNodeType) => {
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
  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleAnswerChange,
  }
}

export default useConfig

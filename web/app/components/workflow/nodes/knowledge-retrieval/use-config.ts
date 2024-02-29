import { useCallback, useState } from 'react'
import produce from 'immer'
import type { ValueSelector } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'

const useConfig = (initInputs: KnowledgeRetrievalNodeType) => {
  const [inputs, setInputs] = useState<KnowledgeRetrievalNodeType>(initInputs)

  const handleQueryVarChange = useCallback((newVar: ValueSelector) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query_variable_selector = newVar
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    inputs,
    handleQueryVarChange,
  }
}

export default useConfig

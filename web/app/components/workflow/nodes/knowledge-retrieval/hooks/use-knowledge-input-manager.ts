import type { RefObject } from 'react'
import type { KnowledgeRetrievalNodeType } from '../types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useCallback, useEffect, useRef } from 'react'
import { RETRIEVE_TYPE } from '@/types/app'
import { normalizeValueSelector } from '../../_base/components/variable/utils'

type Params = {
  inputs: KnowledgeRetrievalNodeType
  doSetInputs: (inputs: KnowledgeRetrievalNodeType) => void
}

const normalizeInputs = (nextInputs: KnowledgeRetrievalNodeType) => {
  return produce(nextInputs, (draft) => {
    draft.query_variable_selector = normalizeValueSelector(nextInputs.query_variable_selector)
    draft.query_attachment_selector = normalizeValueSelector(nextInputs.query_attachment_selector)
    if (nextInputs.retrieval_mode === RETRIEVE_TYPE.multiWay) delete draft.single_retrieval_config
    else delete draft.multiple_retrieval_config
  })
}

const useKnowledgeInputManager = ({ inputs, doSetInputs }: Params) => {
  const inputRef = useRef(inputs)

  useEffect(() => {
    inputRef.current = inputs
  }, [inputs])

  const setInputs = useCallback(
    (nextInputs: KnowledgeRetrievalNodeType) => {
      const normalizedInputs = normalizeInputs(nextInputs)
      doSetInputs(normalizedInputs)
      inputRef.current = normalizedInputs
    },
    [doSetInputs],
  )

  const handleQueryVarChange = useCallback(
    (newVar: ValueSelector | string) => {
      const nextInputs = produce(inputRef.current, (draft) => {
        draft.query_variable_selector = normalizeValueSelector(newVar)
      })
      setInputs(nextInputs)
    },
    [setInputs],
  )

  const handleQueryAttachmentChange = useCallback(
    (newVar: ValueSelector | string) => {
      const nextInputs = produce(inputRef.current, (draft) => {
        draft.query_attachment_selector = normalizeValueSelector(newVar)
      })
      setInputs(nextInputs)
    },
    [setInputs],
  )

  return {
    inputRef: inputRef as RefObject<KnowledgeRetrievalNodeType>,
    setInputs,
    handleQueryVarChange,
    handleQueryAttachmentChange,
  }
}

export default useKnowledgeInputManager

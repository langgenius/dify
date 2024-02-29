import { useCallback, useState } from 'react'
import produce from 'immer'
import type { ValueSelector } from '../../types'
import type { KnowledgeRetrievalNodeType, MultipleRetrievalConfig } from './types'
import type { RETRIEVE_TYPE } from '@/types/app'
import type { DataSet } from '@/models/datasets'

const useConfig = (initInputs: KnowledgeRetrievalNodeType) => {
  const [inputs, setInputs] = useState<KnowledgeRetrievalNodeType>(initInputs)
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  const handleQueryVarChange = useCallback((newVar: ValueSelector) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query_variable_selector = newVar
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRetrievalModeChange = useCallback((newMode: RETRIEVE_TYPE) => {
    const newInputs = produce(inputs, (draft) => {
      draft.retrieval_mode = newMode
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleMultipleRetrievalConfigChange = useCallback((newConfig: MultipleRetrievalConfig) => {
    const newInputs = produce(inputs, (draft) => {
      draft.multiple_retrieval_config = newConfig
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleOnDatasetsChange = useCallback((newDatasets: DataSet[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.dataset_ids = newDatasets.map(d => d.id)
    })
    setInputs(newInputs)
    setSelectedDatasets(newDatasets)
  }, [inputs, setInputs])

  return {
    inputs,
    handleQueryVarChange,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    handleOnDatasetsChange,
  }
}

export default useConfig

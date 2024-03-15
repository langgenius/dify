import { useCallback, useEffect, useState } from 'react'
import produce from 'immer'
import type { ValueSelector, Var } from '../../types'
import { BlockEnum, VarType } from '../../types'
import { useIsChatMode, useWorkflow } from '../../hooks'
import type { KnowledgeRetrievalNodeType, MultipleRetrievalConfig } from './types'
import type { RETRIEVE_TYPE } from '@/types/app'
import type { DataSet } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'

const useConfig = (id: string, payload: KnowledgeRetrievalNodeType) => {
  const isChatMode = useIsChatMode()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const startNode = getBeforeNodesInSameBranch(id).find(node => node.data.type === BlockEnum.Start)
  const startNodeId = startNode?.id
  const { inputs, setInputs } = useNodeCrud<KnowledgeRetrievalNodeType>(id, payload)
  const handleQueryVarChange = useCallback((newVar: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query_variable_selector = newVar as ValueSelector
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

  // datasets
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  useEffect(() => {
    (async () => {
      const datasetIds = inputs.dataset_ids
      if (datasetIds?.length > 0) {
        const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } })
        setSelectedDatasets(dataSetsWithDetail)
      }
      const newInputs = produce(inputs, (draft) => {
        draft.dataset_ids = datasetIds
      })
      setInputs(newInputs)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (inputs._isReady) {
      if (isChatMode && inputs.query_variable_selector.length === 0 && startNodeId) {
        handleQueryVarChange(
          [startNodeId, 'sys.query'],
        )
      }
    }
  }, [inputs._isReady])

  const handleOnDatasetsChange = useCallback((newDatasets: DataSet[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.dataset_ids = newDatasets.map(d => d.id)
    })
    setInputs(newInputs)
    setSelectedDatasets(newDatasets)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.string
  }, [])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<KnowledgeRetrievalNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {
      query: '',
    },
  })

  const query = runInputData.query
  const setQuery = useCallback((newQuery: string) => {
    setRunInputData({
      ...runInputData,
      query: newQuery,
    })
  }, [runInputData, setRunInputData])

  return {
    inputs,
    handleQueryVarChange,
    filterVar,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    selectedDatasets,
    handleOnDatasetsChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    query,
    setQuery,
    runResult,
  }
}

export default useConfig

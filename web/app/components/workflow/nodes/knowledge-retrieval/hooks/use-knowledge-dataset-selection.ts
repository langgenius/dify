import type { MutableRefObject } from 'react'
import type { KnowledgeRetrievalNodeType } from '../types'
import type { DataSet } from '@/models/datasets'
import {
  produce,
} from 'immer'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { fetchDatasets } from '@/service/datasets'
import { RETRIEVE_TYPE } from '@/types/app'
import { getMultipleRetrievalConfig, getSelectedDatasetsMode } from '../utils'

type ModelIdentity = {
  provider?: string
  model?: string
}

type Params = {
  inputs: KnowledgeRetrievalNodeType
  inputRef: MutableRefObject<KnowledgeRetrievalNodeType>
  setInputs: (inputs: KnowledgeRetrievalNodeType) => void
  payloadRetrievalMode: RETRIEVE_TYPE
  updateDatasetsDetail: (datasets: DataSet[]) => void
  fallbackRerankModel: ModelIdentity
}

const useKnowledgeDatasetSelection = ({
  inputs,
  inputRef,
  setInputs,
  payloadRetrievalMode,
  updateDatasetsDetail,
  fallbackRerankModel,
}: Params) => {
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  const [selectedDatasetsLoaded, setSelectedDatasetsLoaded] = useState(false)
  const [rerankModelOpen, setRerankModelOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      const currentInputs = inputRef.current
      const datasetIds = currentInputs.dataset_ids
      if (datasetIds.length > 0) {
        const { data: dataSetsWithDetail } = await fetchDatasets({
          url: '/datasets',
          params: {
            page: 1,
            ids: datasetIds,
          },
        })
        setSelectedDatasets(dataSetsWithDetail)
      }

      const nextInputs = produce(currentInputs, (draft) => {
        draft.dataset_ids = datasetIds
      })
      setInputs(nextInputs)
      setSelectedDatasetsLoaded(true)
    })()
  }, [inputRef, setInputs])

  const handleOnDatasetsChange = useCallback((newDatasets: DataSet[]) => {
    const {
      mixtureHighQualityAndEconomic,
      mixtureInternalAndExternal,
      inconsistentEmbeddingModel,
      allInternal,
      allExternal,
    } = getSelectedDatasetsMode(newDatasets)
    const noMultiModalDatasets = newDatasets.every(dataset => !dataset.is_multimodal)

    const nextInputs = produce(inputs, (draft) => {
      draft.dataset_ids = newDatasets.map(dataset => dataset.id)

      if (payloadRetrievalMode === RETRIEVE_TYPE.multiWay && newDatasets.length > 0) {
        draft.multiple_retrieval_config = getMultipleRetrievalConfig(
          draft.multiple_retrieval_config!,
          newDatasets,
          selectedDatasets,
          fallbackRerankModel,
        )
      }

      if (noMultiModalDatasets)
        draft.query_attachment_selector = []
    })

    updateDatasetsDetail(newDatasets)
    setInputs(nextInputs)
    setSelectedDatasets(newDatasets)

    if (
      (allInternal && (mixtureHighQualityAndEconomic || inconsistentEmbeddingModel))
      || mixtureInternalAndExternal
      || allExternal
    ) {
      setRerankModelOpen(true)
    }
  }, [fallbackRerankModel, inputs, payloadRetrievalMode, selectedDatasets, setInputs, updateDatasetsDetail])

  const showImageQueryVarSelector = useMemo(() => {
    return selectedDatasets.some(dataset => dataset.is_multimodal)
  }, [selectedDatasets])

  return {
    selectedDatasets,
    selectedDatasetsLoaded,
    rerankModelOpen,
    setRerankModelOpen,
    handleOnDatasetsChange,
    showImageQueryVarSelector,
  }
}

export default useKnowledgeDatasetSelection

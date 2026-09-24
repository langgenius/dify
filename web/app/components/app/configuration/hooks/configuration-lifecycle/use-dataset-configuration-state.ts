import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import { useCallback, useRef, useState } from 'react'
import { DATASET_DEFAULT } from '@/config'
import { RETRIEVE_TYPE } from '@/types/app'

export function useDatasetConfigurationState() {
  const [datasetConfigs, setDatasetConfigs] = useState<DatasetConfigs>({
    retrieval_model: RETRIEVE_TYPE.multiWay,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: DATASET_DEFAULT.top_k,
    score_threshold_enabled: false,
    score_threshold: DATASET_DEFAULT.score_threshold,
    datasets: {
      datasets: [],
    },
  })
  const datasetConfigsRef = useRef(datasetConfigs)
  const updateDatasetConfigs = useCallback((nextDatasetConfigs: DatasetConfigs) => {
    setDatasetConfigs(nextDatasetConfigs)
    datasetConfigsRef.current = nextDatasetConfigs
  }, [])
  const [dataSets, setDataSets] = useState<DataSet[]>([])

  return {
    dataSets,
    datasetConfigs,
    datasetConfigsRef,
    setDataSets,
    setDatasetConfigs: updateDatasetConfigs,
  }
}

import type { ConfigurationPublishConfig } from './types'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import { useCallback, useRef, useState } from 'react'

export function useDatasetConfigurationState(initialConfig: ConfigurationPublishConfig) {
  const [datasetConfigs, setDatasetConfigs] = useState<DatasetConfigs>(initialConfig.datasetConfigs)
  const datasetConfigsRef = useRef(datasetConfigs)
  const updateDatasetConfigs = useCallback((nextDatasetConfigs: DatasetConfigs) => {
    setDatasetConfigs(nextDatasetConfigs)
    datasetConfigsRef.current = nextDatasetConfigs
  }, [])
  const [dataSets, setDataSets] = useState<DataSet[]>(initialConfig.modelConfig.dataSets ?? [])

  return {
    dataSets,
    datasetConfigs,
    datasetConfigsRef,
    setDataSets,
    setDatasetConfigs: updateDatasetConfigs,
  }
}

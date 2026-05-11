import type { QueryObserverResult, RefetchOptions } from '@tanstack/react-query'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { DataSet } from '@/models/datasets'
import { createContext, useContext, useContextSelector } from 'use-context-selector'

type DatasetDetailContextValue = {
  indexingTechnique?: IndexingType
  dataset?: DataSet
  mutateDatasetRes?: (options?: RefetchOptions | undefined) => Promise<QueryObserverResult<DataSet, Error>>
}
const DatasetDetailContext = createContext<DatasetDetailContextValue>({})

export const useDatasetDetailContext = () => useContext(DatasetDetailContext)

export const useDatasetDetailContextWithSelector = <T>(selector: (value: DatasetDetailContextValue) => T): T => {
  return useContextSelector(DatasetDetailContext, selector)
}
export default DatasetDetailContext

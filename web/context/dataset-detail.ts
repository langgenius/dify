import { createContext, useContext, useContextSelector } from 'use-context-selector'
import type { DataSet } from '@/models/datasets'
type DatasetDetailContextValue = {
  indexingTechnique?: string
  dataset?: DataSet
  mutateDatasetRes?: () => void
}
const DatasetDetailContext = createContext<DatasetDetailContextValue>({})

export const useDatasetDetailContext = () => useContext(DatasetDetailContext)

export const useDatasetDetailContextWithSelector = (selector: (value: DatasetDetailContextValue) => any) => {
  return useContextSelector(DatasetDetailContext, selector)
}
export default DatasetDetailContext

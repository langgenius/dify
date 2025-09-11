import { createContext, use } from 'react'
import type { DataSet } from '@/models/datasets'
import type { IndexingType } from '@/app/components/datasets/create/step-two'

type DatasetDetailContextValue = {
  indexingTechnique?: IndexingType
  dataset?: DataSet
  mutateDatasetRes?: () => void
}
const DatasetDetailContext = createContext<DatasetDetailContextValue>({})

export const useDatasetDetailContext = () => use(DatasetDetailContext)

export const useDatasetDetailContextWithSelector = (selector: (value: DatasetDetailContextValue) => any) => {
  return selector(use(DatasetDetailContext))
}
export default DatasetDetailContext

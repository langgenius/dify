import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { QueryObserverResult, RefetchOptions } from '@tanstack/react-query'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import { createContext, useContext, useContextSelector } from 'use-context-selector'

type DatasetDetailContextValue = {
  indexingTechnique?: IndexingType
  dataset?: DatasetDetailWithPartialMembersResponse
  mutateDatasetRes?: (
    options?: RefetchOptions | undefined,
  ) => Promise<QueryObserverResult<DatasetDetailWithPartialMembersResponse, Error>>
}
const DatasetDetailContext = createContext<DatasetDetailContextValue>({})

export const useDatasetDetailContext = () => useContext(DatasetDetailContext)

export const useDatasetDetailContextWithSelector = <T>(
  selector: (value: DatasetDetailContextValue) => T,
): T => {
  return useContextSelector(DatasetDetailContext, selector)
}
export default DatasetDetailContext

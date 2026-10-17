import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { SelectedDatasetsMode } from '@/models/datasets'
import { useMemo } from 'react'
import { getSelectedDatasetsMode } from './utils'

export const useSelectedDatasetsMode = (datasets: DatasetDetailWithPartialMembersResponse[]) => {
  const selectedDatasetsMode: SelectedDatasetsMode = useMemo(() => {
    return getSelectedDatasetsMode(datasets)
  }, [datasets])

  return selectedDatasetsMode
}

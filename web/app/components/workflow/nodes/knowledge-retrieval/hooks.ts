import { useMemo } from 'react'
import { getSelectedDatasetsMode } from './utils'
import type {
  DataSet,
  SelectedDatasetsMode,
} from '@/models/datasets'

export const useSelectedDatasetsMode = (datasets: DataSet[]) => {
  const selectedDatasetsMode: SelectedDatasetsMode = useMemo(() => {
    return getSelectedDatasetsMode(datasets)
  }, [datasets])

  return selectedDatasetsMode
}

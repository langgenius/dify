import type {
  DataSet,
  SelectedDatasetsMode,
} from '@/models/datasets'
import { useMemo } from 'react'
import { getSelectedDatasetsMode } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'

export const useSelectedDatasetsMode = (datasets: DataSet[]) => {
  const selectedDatasetsMode: SelectedDatasetsMode = useMemo(() => {
    return getSelectedDatasetsMode(datasets)
  }, [datasets])

  return selectedDatasetsMode
}

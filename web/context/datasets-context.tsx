'use client'

import { createContext, useContext } from 'use-context-selector'
import type { DataSet } from '@/models/datasets'
import { noop } from 'lodash-es'

export type DatasetsContextValue = {
  datasets: DataSet[]
  mutateDatasets: () => void
  currentDataset?: DataSet
}

const DatasetsContext = createContext<DatasetsContextValue>({
  datasets: [],
  mutateDatasets: noop,
  currentDataset: undefined,
})

export const useDatasetsContext = () => useContext(DatasetsContext)

export default DatasetsContext

'use client'

import type { DataSet } from '@/models/datasets'
import { noop } from 'es-toolkit/function'
import { createContext, useContext } from 'use-context-selector'

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

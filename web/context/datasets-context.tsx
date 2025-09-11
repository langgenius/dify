'use client'

import { createContext, use } from 'react'
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

export const useDatasetsContext = () => use(DatasetsContext)

export default DatasetsContext

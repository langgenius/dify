'use client'

import type { DataSet } from '@/models/datasets'
import { createSelectorCtx } from '@/utils/context'

export type DatasetsContextValue = {
  datasets: DataSet[]
  mutateDatasets: () => void
  currentDataset?: DataSet
}

const [, useDatasetsContext, DatasetsContext] = createSelectorCtx<DatasetsContextValue>()

export { useDatasetsContext }

export default DatasetsContext

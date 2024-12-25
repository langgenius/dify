import { createContext, useContext } from 'use-context-selector'
import type { DataSet } from '@/models/datasets'

const DatasetDetailContext = createContext<{ indexingTechnique?: string; dataset?: DataSet; mutateDatasetRes?: () => void }>({})

export const useDatasetDetailContext = () => useContext(DatasetDetailContext)

export default DatasetDetailContext

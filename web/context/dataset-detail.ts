import { createContext } from 'use-context-selector'
import type { DataSet } from '@/models/datasets'

const DatasetDetailContext = createContext<{ indexingTechnique?: string; dataset?: DataSet }>({})

export default DatasetDetailContext

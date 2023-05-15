import { createContext } from 'use-context-selector'

const DatasetDetailContext = createContext<{ indexingTechnique?: string; }>({})

export default DatasetDetailContext

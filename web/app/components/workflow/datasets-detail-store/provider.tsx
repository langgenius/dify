import type { FC } from 'react'
import { createContext, useCallback, useEffect, useRef } from 'react'
import { createDatasetsDetailStore } from './store'
import { BlockEnum } from '../types'
import type { KnowledgeRetrievalNodeType } from '../nodes/knowledge-retrieval/types'
import { fetchDatasets } from '@/service/datasets'
import { useNodes } from 'reactflow'

type DatasetsDetailStoreApi = ReturnType<typeof createDatasetsDetailStore>

type DatasetsDetailContextType = DatasetsDetailStoreApi | undefined

export const DatasetsDetailContext = createContext<DatasetsDetailContextType>(undefined)

type DatasetsDetailProviderProps = {
  children: React.ReactNode
}

const DatasetsDetailProvider: FC<DatasetsDetailProviderProps> = ({
  children,
}) => {
  const storeRef = useRef<DatasetsDetailStoreApi>()
  const nodes = useNodes<KnowledgeRetrievalNodeType>()

  if (!storeRef.current)
    storeRef.current = createDatasetsDetailStore()

  const knowledgeRetrievalNodes = nodes.filter(node => node.data.type === BlockEnum.KnowledgeRetrieval)

  const getDatasetsDetail = useCallback(async () => {
    if (!storeRef.current) return
    const allDatasetIds = knowledgeRetrievalNodes.reduce<string[]>((acc, node) => {
      return [...acc, ...node.data.dataset_ids]
    }, [])
    const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: allDatasetIds } })
    storeRef.current.setState({ datasetsDetail: dataSetsWithDetail })
  }, [knowledgeRetrievalNodes])

  useEffect(() => {
    getDatasetsDetail()
  }, [getDatasetsDetail])

  return (
    <DatasetsDetailContext.Provider value={storeRef.current!}>
      {children}
    </DatasetsDetailContext.Provider>
  )
}

export default DatasetsDetailProvider

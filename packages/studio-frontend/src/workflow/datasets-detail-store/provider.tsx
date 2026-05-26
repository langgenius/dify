import type { FC } from 'react'
import type { KnowledgeRetrievalNodeType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { CommonNodeType, Node } from '@/app/components/workflow/types'
import { createContext, useCallback, useEffect, useRef } from 'react'
import { fetchDatasets } from '@/service/datasets'
import { BlockEnum } from '@/app/components/workflow/types'
import { createDatasetsDetailStore } from '@/app/components/workflow/datasets-detail-store/store'

type DatasetsDetailStoreApi = ReturnType<typeof createDatasetsDetailStore>

type DatasetsDetailContextType = DatasetsDetailStoreApi | undefined

export const DatasetsDetailContext = createContext<DatasetsDetailContextType>(undefined)

type DatasetsDetailProviderProps = {
  nodes: Node[]
  children: React.ReactNode
}

const DatasetsDetailProvider: FC<DatasetsDetailProviderProps> = ({
  nodes,
  children,
}) => {
  const storeRef = useRef<DatasetsDetailStoreApi>(undefined)

  if (!storeRef.current)
    storeRef.current = createDatasetsDetailStore()

  const updateDatasetsDetail = useCallback(async (datasetIds: string[]) => {
    const { data: datasetsDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } })
    if (datasetsDetail && datasetsDetail.length > 0)
      storeRef.current!.getState().updateDatasetsDetail(datasetsDetail)
  }, [])

  useEffect(() => {
    if (!storeRef.current)
      return
    const knowledgeRetrievalNodes = nodes.filter(node => node.data.type === BlockEnum.KnowledgeRetrieval)
    const allDatasetIds = knowledgeRetrievalNodes.reduce<string[]>((acc, node) => {
      return Array.from(new Set([...acc, ...(node.data as CommonNodeType<KnowledgeRetrievalNodeType>).dataset_ids]))
    }, [])
    if (allDatasetIds.length === 0)
      return
    updateDatasetsDetail(allDatasetIds)
  }, [])

  return (
    <DatasetsDetailContext.Provider value={storeRef.current!}>
      {children}
    </DatasetsDetailContext.Provider>
  )
}

export default DatasetsDetailProvider

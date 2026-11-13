import type { FC } from 'react'
import type { KnowledgeRetrievalNodeType } from '../nodes/knowledge-retrieval/types'
import type { CommonNodeType, Node } from '../types'
import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { fetchDatasets } from '@/service/datasets'
import { BlockEnum } from '../types'
import { createDatasetsDetailStore } from './store'

type DatasetsDetailStoreApi = ReturnType<typeof createDatasetsDetailStore>

type DatasetsDetailContextType = DatasetsDetailStoreApi | undefined

export const DatasetsDetailContext = createContext<DatasetsDetailContextType>(undefined)

type DatasetsDetailProviderProps = {
  nodes: Node[]
  children: React.ReactNode
}

const DatasetsDetailProvider: FC<DatasetsDetailProviderProps> = ({ nodes, children }) => {
  const [store] = useState(createDatasetsDetailStore)

  const updateDatasetsDetail = useCallback(
    async (datasetIds: string[]) => {
      const { data: datasetsDetail } = await fetchDatasets({
        params: { page: 1, ids: datasetIds },
      })
      if (datasetsDetail && datasetsDetail.length > 0)
        store.getState().updateDatasetsDetail(datasetsDetail)
    },
    [store],
  )

  const datasetIds = useMemo(
    () =>
      Array.from(
        new Set(
          nodes
            .filter((node) => node.data.type === BlockEnum.KnowledgeRetrieval)
            .flatMap(
              (node) => (node.data as CommonNodeType<KnowledgeRetrievalNodeType>).dataset_ids,
            ),
        ),
      ),
    [nodes],
  )
  // React Flow replaces node objects on every drag/render, but consumers only need
  // a refresh when the referenced dataset ids change. Split on NUL so the effect
  // depends on the id set rather than the nodes array identity (dataset ids are UUIDs).
  const datasetIdsKey = datasetIds.join('\u0000')

  useEffect(() => {
    if (!datasetIdsKey) return
    updateDatasetsDetail(datasetIdsKey.split('\u0000'))
  }, [datasetIdsKey, updateDatasetsDetail])

  return <DatasetsDetailContext.Provider value={store}>{children}</DatasetsDetailContext.Provider>
}

export default DatasetsDetailProvider

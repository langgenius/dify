import type { FC } from 'react'
import type { KnowledgeRetrievalNodeType } from '../nodes/knowledge-retrieval/types'
import type { CommonNodeType, Node } from '../types'
import { createContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDatasets } from '@/service/datasets'
import { useStore } from '../store/workflow'
import { BlockEnum } from '../types'
import { createDatasetsDetailStore } from './store'

type DatasetsDetailStoreApi = ReturnType<typeof createDatasetsDetailStore>

type DatasetsDetailContextType = DatasetsDetailStoreApi | undefined

export const DatasetsDetailContext = createContext<DatasetsDetailContextType>(undefined)

type DatasetsDetailProviderProps = {
  nodes: Node[]
  children: React.ReactNode
}

function getKnowledgeDatasetIds(nodes: Node[]) {
  return Array.from(
    new Set(
      nodes.flatMap((node) =>
        node.data.type === BlockEnum.KnowledgeRetrieval
          ? (node.data as CommonNodeType<KnowledgeRetrievalNodeType>).dataset_ids
          : [],
      ),
    ),
  )
}

const DatasetsDetailProvider: FC<DatasetsDetailProviderProps> = ({ nodes, children }) => {
  const [store] = useState(createDatasetsDetailStore)
  const workflowNodes = useStore((state) => state.nodes)
  const sourceNodes = workflowNodes.length ? workflowNodes : nodes
  const datasetIds = useMemo(() => getKnowledgeDatasetIds(sourceNodes).sort(), [sourceNodes])
  const datasetIdsKey = JSON.stringify(datasetIds)
  const lastDatasetIdsKeyRef = useRef('[]')
  const requestedDatasetIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (datasetIdsKey === lastDatasetIdsKeyRef.current) return
    lastDatasetIdsKeyRef.current = datasetIdsKey
    const missingIds = datasetIds.filter(
      (id) => !store.getState().datasetsDetail[id] && !requestedDatasetIdsRef.current.has(id),
    )
    if (!missingIds.length) return
    missingIds.forEach((id) => requestedDatasetIdsRef.current.add(id))

    void fetchDatasets({ url: '/datasets', params: { page: 1, ids: missingIds } })
      .then(({ data }) => {
        if (data?.length) store.getState().updateDatasetsDetail(data)
      })
      .catch((error: unknown) => {
        if (lastDatasetIdsKeyRef.current === datasetIdsKey) lastDatasetIdsKeyRef.current = ''
        console.error('Failed to load workflow dataset details', error)
      })
      .finally(() => {
        missingIds.forEach((id) => requestedDatasetIdsRef.current.delete(id))
      })
  }, [datasetIds, datasetIdsKey, store])

  return <DatasetsDetailContext value={store}>{children}</DatasetsDetailContext>
}

export default DatasetsDetailProvider

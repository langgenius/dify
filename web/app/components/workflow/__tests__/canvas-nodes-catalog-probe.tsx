import type { AvailableNodesMetaData } from '../hooks-store'
import { use, useLayoutEffect } from 'react'
import { useNodes } from 'reactflow'
import { HooksStoreContext } from '../hooks-store'
import { useWorkflowNodeCatalog } from '../node-catalog'

export const CANVAS_NODES_STATUS_NAME = 'Canvas nodes'

// Publishes the real block catalog so node actions know which canvas nodes are copyable.
export function CanvasNodesCatalogProbe() {
  const catalog = useWorkflowNodeCatalog()
  const hooksStore = use(HooksStoreContext)!
  useLayoutEffect(() => {
    const nodesMap = catalog.nodesMap as NonNullable<AvailableNodesMetaData['nodesMap']>
    hooksStore.setState({
      availableNodesMetaData: {
        nodes: catalog.nodes.map((node) => nodesMap[node.metaData.type]),
        nodesMap,
      },
    })
  }, [catalog, hooksStore])
  const nodes = useNodes<{ selected?: boolean }>()

  return (
    <output aria-label={CANVAS_NODES_STATUS_NAME}>
      {nodes.map((node) => `${node.id}${node.data.selected ? '*' : ''}`).join(',')}
    </output>
  )
}

import type { Node } from '../../../types'
import { useStore } from 'reactflow'
import { isToolNode, resolveToolAuthorization } from '../authorization'
import { ToolCredentialSource } from '../types'

export function useToolAuthorization(id: string, data: Node['data'], enabled = true) {
  const node = { id, data }
  const reuseNodeId =
    enabled && isToolNode(node) && node.data.credential_source === ToolCredentialSource.ReuseNode
      ? node.data.reuse_node_id
      : undefined
  const sourceData = useStore((state): Node['data'] | undefined =>
    reuseNodeId ? state.nodeInternals.get(reuseNodeId)?.data : undefined,
  )

  if (!enabled) return undefined

  return resolveToolAuthorization({
    node,
    nodes: reuseNodeId && sourceData ? [{ id: reuseNodeId, data: sourceData }] : [],
  })
}

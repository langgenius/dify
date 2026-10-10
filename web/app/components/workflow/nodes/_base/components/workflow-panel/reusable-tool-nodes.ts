import type { ReusableNode } from '@/app/components/plugins/plugin-auth/reuse-from-node/model'
import type { Collection } from '@/app/components/tools/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { AppUserAuthSliceShape } from '@/app/components/workflow/store/workflow/app-user-auth-slice'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

type ReusableToolNodesParams = {
  nodes: Node[]
  nodeId: string
  provider: string
  nodeAuthDrafts: AppUserAuthSliceShape['nodeAuthDrafts']
  toolIcon?: Collection['icon']
}

const isToolNode = (node: Node | undefined): node is Node<ToolNodeType> =>
  node?.data.type === BlockEnum.Tool

const isSameProvider = (left: Node<ToolNodeType>, right: Node<ToolNodeType>) =>
  left.data.provider_type === right.data.provider_type &&
  left.data.provider_id === right.data.provider_id

export const getReusableToolNodes = ({
  nodes,
  nodeId,
  provider,
  nodeAuthDrafts,
  toolIcon,
}: ReusableToolNodesParams): ReusableNode[] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const currentNode = nodesById.get(nodeId)
  if (!isToolNode(currentNode)) return []

  const getAuthorizationDraft = (node: Node<ToolNodeType>) => {
    const draft = nodeAuthDrafts[node.id]
    return draft?.provider === provider && draft.providerId === node.data.provider_id
      ? draft
      : undefined
  }

  const getReuseTarget = (node: Node<ToolNodeType>) => {
    const draft = getAuthorizationDraft(node)
    const reference = draft?.reuseFromNode
    if (draft?.authorizationTab !== 'reuse-from-node' || !reference) return undefined

    const target = nodesById.get(reference.source.id)
    return isToolNode(target) && isSameProvider(node, target) ? target : undefined
  }

  const hasReuseCycle = (candidate: Node<ToolNodeType>) => {
    const visited = new Set([nodeId])
    let source: Node<ToolNodeType> | undefined = candidate
    while (source) {
      if (visited.has(source.id)) return true
      visited.add(source.id)
      source = getReuseTarget(source)
    }
    return false
  }

  return nodes.flatMap((node) => {
    if (node.id === nodeId || !isToolNode(node) || !isSameProvider(currentNode, node)) return []
    const sourceMode = getAuthorizationDraft(node)?.authorizationTab ?? 'workspace-auth'
    return [
      {
        id: node.id,
        title: node.data.title,
        icon: toolIcon || node.data.provider_icon || currentNode.data.provider_icon,
        source:
          sourceMode === 'app-user-auth'
            ? 'app-user'
            : sourceMode === 'reuse-from-node'
              ? 'reuse'
              : 'workspace',
        disabled: hasReuseCycle(node),
      },
    ]
  })
}

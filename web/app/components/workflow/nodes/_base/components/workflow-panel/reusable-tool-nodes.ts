import type { ReusableNode } from '@/app/components/plugins/plugin-auth/reuse-from-node/model'
import type { Collection } from '@/app/components/tools/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Node } from '@/app/components/workflow/types'
import { getToolAuthorizationTab } from '@/app/components/workflow/nodes/tool/authorization-config'
import { BlockEnum } from '@/app/components/workflow/types'

type ReusableToolNodesParams = {
  nodes: Node[]
  nodeId: string
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
  toolIcon,
}: ReusableToolNodesParams): ReusableNode[] => {
  const currentNode = nodes.find((node) => node.id === nodeId)
  if (!isToolNode(currentNode)) return []

  return nodes.flatMap((node) => {
    if (node.id === nodeId || !isToolNode(node) || !isSameProvider(currentNode, node)) return []
    const sourceMode = getToolAuthorizationTab(node.data)
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
        disabled: sourceMode === 'reuse-from-node',
      },
    ]
  })
}

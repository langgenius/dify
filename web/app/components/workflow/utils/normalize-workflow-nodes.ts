import { BlockEnum } from '../types'

export const normalizeWorkflowNodes = <T extends { data: Record<string, unknown> }>(
  nodes: T[],
  appMode?: string,
): T[] => {
  if (appMode === 'advanced-chat') {
    return nodes.map((node) => {
      if (
        node.data.agent_node_kind !== 'dify_agent' ||
        typeof node.data.continue_agent_session === 'boolean'
      )
        return node

      return { ...node, data: { ...node.data, continue_agent_session: true } }
    })
  }

  if (appMode !== 'workflow') return nodes

  return nodes.map((node) => {
    if (node.data.type !== BlockEnum.LLM || !('memory' in node.data)) return node

    // A memory object implicitly requires sys.query, which plain Workflows do not provide.
    const data = { ...node.data }
    delete data.memory
    return { ...node, data }
  })
}

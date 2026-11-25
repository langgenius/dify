import { isAgentV2NodeData } from '../nodes/agent-v2/types'
import { BlockEnum } from '../types'

export const normalizeWorkflowNodes = <T extends { data: Record<string, unknown> }>(
  nodes: T[],
  appMode?: string,
): T[] => {
  if (appMode === 'advanced-chat') {
    return nodes.map((node) => {
      if (!isAgentV2NodeData(node.data) || typeof node.data.continue_agent_session === 'boolean')
        return node

      // A missing setting in a draft save preserves the server's current mode.
      // Send the effective default so undo can restore it on legacy nodes.
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

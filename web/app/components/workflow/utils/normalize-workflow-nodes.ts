import { AppModeEnum } from '@/types/app'
import { BlockEnum } from '../types'

export const normalizeWorkflowNodes = <T extends { data: Record<string, unknown> }>(
  nodes: T[],
  appMode?: string,
): T[] => {
  if (appMode !== AppModeEnum.WORKFLOW) return nodes

  return nodes.map((node) => {
    if (node.data.type !== BlockEnum.LLM || !('memory' in node.data)) return node

    // A memory object implicitly requires sys.query, which plain Workflows do not provide.
    const data = { ...node.data }
    delete data.memory
    return { ...node, data }
  })
}

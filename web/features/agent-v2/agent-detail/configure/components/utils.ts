import type { AgentFileNode } from './configured-data'

export function countAgentFileNodes(files: AgentFileNode[]): number {
  return files.reduce((count, file) => count + 1 + (file.children ? countAgentFileNodes(file.children) : 0), 0)
}

export function getFirstAgentFileId(files: AgentFileNode[]): string | undefined {
  for (const file of files) {
    if (!file.children?.length)
      return file.id

    const childFileId = getFirstAgentFileId(file.children)
    if (childFileId)
      return childFileId
  }
}

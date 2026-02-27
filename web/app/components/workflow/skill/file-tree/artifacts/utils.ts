import type {
  SandboxFileNode,
  SandboxFileTreeNode,
} from '@/types/sandbox-file'

export function buildTreeFromFlatList(nodes: SandboxFileNode[]): SandboxFileTreeNode[] {
  const nodeMap = new Map<string, SandboxFileTreeNode>()
  const roots: SandboxFileTreeNode[] = []

  const sorted = [...nodes].sort((a, b) =>
    a.path.split('/').length - b.path.split('/').length,
  )

  for (const node of sorted) {
    const parts = node.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')

    const treeNode: SandboxFileTreeNode = {
      id: node.path,
      name,
      path: node.path,
      node_type: node.is_dir ? 'folder' : 'file',
      size: node.size,
      mtime: node.mtime,
      extension: node.extension,
      children: [],
    }

    nodeMap.set(node.path, treeNode)

    if (parentPath === '') {
      roots.push(treeNode)
    }
    else {
      const parent = nodeMap.get(parentPath)
      if (parent)
        parent.children.push(treeNode)
    }
  }

  return roots
}

export type PermissionLeaf = {
  id: string
  name: string
}

export type PermissionGroup = {
  id: string
  label: string
  items: PermissionLeaf[]
}

export type PermissionNode
  = | { kind: 'leaf', leaf: PermissionLeaf }
    | { kind: 'group', group: PermissionGroup }

export type ResourceType = 'app' | 'knowledge_base'

const APP_PERMISSION_NODES: PermissionNode[] = [
  { kind: 'leaf', leaf: { id: 'app.editing_and_layout', name: 'Editing and layout app' } },
  { kind: 'leaf', leaf: { id: 'app.test_and_debug', name: 'Test and debug app' } },
  { kind: 'leaf', leaf: { id: 'app.delete', name: 'Delete app' } },
  { kind: 'leaf', leaf: { id: 'app.import_export_dsl', name: 'Import and Export DSL' } },
  { kind: 'leaf', leaf: { id: 'app.release_version_management', name: 'Application Release and Version Management' } },
  { kind: 'leaf', leaf: { id: 'app.annotation_management', name: 'Annotation Management' } },
  {
    kind: 'group',
    group: {
      id: 'app.api_management',
      label: 'API Management',
      items: [
        { id: 'app.api_management.toggle', name: 'Enable/Disable API Access' },
        { id: 'app.api_management.create_key', name: 'Create App API Key' },
        { id: 'app.api_management.delete_key', name: 'Delete App API Key' },
      ],
    },
  },
]

const KNOWLEDGE_BASE_PERMISSION_NODES: PermissionNode[] = [
  { kind: 'leaf', leaf: { id: 'kb.view', name: 'View Knowledge Base' } },
  { kind: 'leaf', leaf: { id: 'kb.edit_configuration', name: 'Edit Knowledge Base Configuration' } },
  {
    kind: 'group',
    group: {
      id: 'kb.manage_documents',
      label: 'Managing Knowledge Base Documents',
      items: [
        { id: 'kb.manage_documents.add', name: 'Add Document' },
        { id: 'kb.manage_documents.delete', name: 'Delete Document' },
        { id: 'kb.manage_documents.download', name: 'Download Document' },
      ],
    },
  },
  { kind: 'leaf', leaf: { id: 'kb.import_export_pipeline', name: 'Import Pipeline from DSL / Export Knowledge Pipeline DSL' } },
  { kind: 'leaf', leaf: { id: 'kb.pipeline_publishing_versioning', name: 'Knowledge Base Pipeline Publishing and Version Management' } },
  { kind: 'leaf', leaf: { id: 'kb.delete', name: 'Delete Knowledge Base' } },
]

export const PERMISSION_NODES_BY_RESOURCE: Record<ResourceType, PermissionNode[]> = {
  app: APP_PERMISSION_NODES,
  knowledge_base: KNOWLEDGE_BASE_PERMISSION_NODES,
}

export const flattenPermissionNodes = (nodes: PermissionNode[]): PermissionLeaf[] => {
  const out: PermissionLeaf[] = []
  for (const node of nodes) {
    if (node.kind === 'leaf')
      out.push(node.leaf)
    else
      out.push(...node.group.items)
  }
  return out
}

export const getPermissionMap = (resourceType: ResourceType): Record<string, PermissionLeaf> => {
  const flat = flattenPermissionNodes(PERMISSION_NODES_BY_RESOURCE[resourceType])
  return Object.fromEntries(flat.map(p => [p.id, p]))
}

export const filterPermissionNodes = (
  nodes: PermissionNode[],
  keyword: string,
): PermissionNode[] => {
  const q = keyword.trim().toLowerCase()
  if (!q)
    return nodes
  const out: PermissionNode[] = []
  for (const node of nodes) {
    if (node.kind === 'leaf') {
      if (node.leaf.name.toLowerCase().includes(q))
        out.push(node)
    }
    else {
      const matchedItems = node.group.items.filter(i => i.name.toLowerCase().includes(q))
      const groupMatch = node.group.label.toLowerCase().includes(q)
      if (groupMatch)
        out.push(node)
      else if (matchedItems.length > 0)
        out.push({ kind: 'group', group: { ...node.group, items: matchedItems } })
    }
  }
  return out
}

export const NESTED_NODE_SEPARATOR = '_ext_'

export type NestedNodeIdParts = {
  parentId: string
  paramKey: string
}

export const buildNestedNodeId = (parentId: string, paramKey: string) => {
  if (!parentId || !paramKey)
    return ''
  return `${parentId}${NESTED_NODE_SEPARATOR}${paramKey}`
}

export const parseNestedNodeId = (id?: string): NestedNodeIdParts | null => {
  if (!id)
    return null
  const index = id.lastIndexOf(NESTED_NODE_SEPARATOR)
  if (index <= 0)
    return null
  const parentId = id.slice(0, index)
  const paramKey = id.slice(index + NESTED_NODE_SEPARATOR.length)
  if (!parentId || !paramKey)
    return null
  return { parentId, paramKey }
}

export const isNestedNodeId = (id?: string) => Boolean(parseNestedNodeId(id))

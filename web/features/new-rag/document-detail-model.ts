import type {
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from './document-models'

export type DocumentChunkTreeNode = {
  children: DocumentChunkTreeNode[]
  chunk: DocumentRevisionChunk
  id: string
  label: string
  parentId?: string
  targetChunkId: string
}

export type DocumentChunkTree = {
  byId: Map<string, DocumentChunkTreeNode>
  chunksById: Map<string, DocumentRevisionChunk>
  roots: DocumentChunkTreeNode[]
}

export function responseStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error)
    return typeof error.status === 'number' ? error.status : undefined
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}

function compareChunks(left: DocumentRevisionChunk, right: DocumentRevisionChunk) {
  return left.ordinal - right.ordinal || left.id.localeCompare(right.id)
}

function cyclicChunkIds(chunksById: Map<string, DocumentRevisionChunk>) {
  const cycleIds = new Set<string>()
  const settledIds = new Set<string>()

  for (const chunkId of chunksById.keys()) {
    if (settledIds.has(chunkId)) continue
    const path: string[] = []
    const pathIndexes = new Map<string, number>()
    let candidateId: string | undefined = chunkId
    while (candidateId && chunksById.has(candidateId) && !settledIds.has(candidateId)) {
      const cycleStart = pathIndexes.get(candidateId)
      if (cycleStart !== undefined) {
        for (const cycleId of path.slice(cycleStart)) cycleIds.add(cycleId)
        break
      }
      pathIndexes.set(candidateId, path.length)
      path.push(candidateId)
      candidateId = chunksById.get(candidateId)?.parentChunkId
    }
    for (const pathId of path) settledIds.add(pathId)
  }

  return cycleIds
}

export function buildDocumentChunkTree(chunks: DocumentRevisionChunk[]): DocumentChunkTree {
  const sortedChunks = [...chunks].sort(compareChunks)
  const chunksById = new Map(sortedChunks.map((chunk) => [chunk.id, chunk]))
  const byId = new Map<string, DocumentChunkTreeNode>()
  const roots: DocumentChunkTreeNode[] = []
  const sectionedChunkIds = new Set<string>()

  for (const chunk of sortedChunks) {
    const sectionPath = chunk.sectionPath.map((segment) => segment.trim()).filter(Boolean)
    if (!sectionPath.length) continue
    sectionedChunkIds.add(chunk.id)
    let parent: DocumentChunkTreeNode | undefined
    for (let index = 0; index < sectionPath.length; index++) {
      const path = sectionPath.slice(0, index + 1)
      const id = sectionTreeNodeId(path)
      let node = byId.get(id)
      if (!node) {
        node = {
          children: [],
          chunk,
          id,
          label: path.at(-1)!,
          ...(parent ? { parentId: parent.id } : {}),
          targetChunkId: chunk.id,
        }
        byId.set(id, node)
        if (parent) parent.children.push(node)
        else roots.push(node)
      }
      parent = node
    }
  }

  const unsectionedChunks = sortedChunks.filter((chunk) => !sectionedChunkIds.has(chunk.id))
  const unsectionedChunksById = new Map(unsectionedChunks.map((chunk) => [chunk.id, chunk]))
  const cycleIds = cyclicChunkIds(unsectionedChunksById)
  const fallbackByChunkId = new Map<string, DocumentChunkTreeNode>()
  for (const chunk of unsectionedChunks) {
    const node = {
      children: [],
      chunk,
      id: chunk.id,
      label: `#${chunk.ordinal}`,
      targetChunkId: chunk.id,
    } satisfies DocumentChunkTreeNode
    fallbackByChunkId.set(chunk.id, node)
    byId.set(node.id, node)
  }

  for (const chunk of unsectionedChunks) {
    const node = fallbackByChunkId.get(chunk.id)!
    const parentId = chunk.parentChunkId
    const parent = parentId ? fallbackByChunkId.get(parentId) : undefined
    if (!parent || !parentId || cycleIds.has(chunk.id)) roots.push(node)
    else {
      node.parentId = parent.id
      parent.children.push(node)
    }
  }

  for (const node of byId.values())
    node.children.sort((left, right) => compareChunks(left.chunk, right.chunk))
  roots.sort((left, right) => compareChunks(left.chunk, right.chunk))
  return { byId, chunksById, roots }
}

function sectionTreeNodeId(sectionPath: string[]) {
  return `section:${encodeURIComponent(JSON.stringify(sectionPath))}`
}

export function visibleDocumentChunkNodes(
  roots: DocumentChunkTreeNode[],
  expandedNodeIds: Set<string>,
) {
  const visible: Array<{
    depth: number
    node: DocumentChunkTreeNode
    positionInSet: number
    setSize: number
  }> = []
  const pending = roots
    .map((node, index) => ({
      depth: 0,
      node,
      positionInSet: index + 1,
      setSize: roots.length,
    }))
    .reverse()
  while (pending.length) {
    const item = pending.pop()!
    const { depth, node } = item
    visible.push(item)
    if (!expandedNodeIds.has(node.id)) continue
    for (let index = node.children.length - 1; index >= 0; index--)
      pending.push({
        depth: depth + 1,
        node: node.children[index]!,
        positionInSet: index + 1,
        setSize: node.children.length,
      })
  }
  return visible
}

export function initialDocumentRevision(
  document: LogicalDocument,
  revisions: LogicalDocumentRevision[],
) {
  const activeRevision = document.activeRevision ?? document.active?.revision
  if (activeRevision !== undefined) return activeRevision
  return revisions
    .filter((revision) => revision?.state === 'active' || revision?.state === 'superseded')
    .reduce<number | undefined>(
      (latest, revision) =>
        revision && (latest === undefined || revision.revision > latest)
          ? revision.revision
          : latest,
      undefined,
    )
}

export function chunkTreeLabel(label: string) {
  const normalizedLabel = label.trim()
  const graphemes: string[] = []
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(normalizedLabel)) {
    graphemes.push(segment)
    if (graphemes.length > 120) break
  }
  return graphemes.length > 120 ? `${graphemes.slice(0, 119).join('')}…` : normalizedLabel
}

export function chunkContentParts(chunk: DocumentRevisionChunk) {
  return {
    body: chunk.text,
    heading: chunk.sectionPath.at(-1)?.trim() ?? '',
  }
}

export function chunkCharacterCount(text: string) {
  let count = 0
  for (const _segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
    count++
  return count
}

function metadataValue(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

export function chunkMetadataEntries(metadata: Record<string, unknown>) {
  return Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, metadataValue(value)] as const)
}

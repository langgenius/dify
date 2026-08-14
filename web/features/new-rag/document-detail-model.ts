import type {
  KnowledgeFsDocumentMultimodalItemResponse,
  KnowledgeFsDocumentOutlineNodeResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
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
  outlineNode?: KnowledgeFsDocumentOutlineNodeResponse
  parentId?: string
  targetChunkId: string
}

export type DocumentChunkTree = {
  byId: Map<string, DocumentChunkTreeNode>
  chunksById: Map<string, DocumentRevisionChunk>
  displayChunks: DocumentRevisionChunk[]
  outlineNodesByChunkId: Map<string, KnowledgeFsDocumentOutlineNodeResponse>
  outlineSummaryChunkIds: Set<string>
  roots: DocumentChunkTreeNode[]
}

export type DocumentMultimodalPlacement = {
  byChunkId: Map<string, KnowledgeFsDocumentMultimodalItemResponse[]>
  unplaced: KnowledgeFsDocumentMultimodalItemResponse[]
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

export function placeDocumentMultimodalItems(
  chunks: DocumentRevisionChunk[],
  items: KnowledgeFsDocumentMultimodalItemResponse[],
): DocumentMultimodalPlacement {
  const orderedChunks = [...chunks].sort(compareChunks)
  const byChunkId = new Map<string, KnowledgeFsDocumentMultimodalItemResponse[]>()
  const unplaced: KnowledgeFsDocumentMultimodalItemResponse[] = []

  for (const item of items) {
    if (item.modality !== 'image') continue
    const target = chunkForMultimodalItem(orderedChunks, item)
    if (!target) {
      unplaced.push(item)
      continue
    }
    const current = byChunkId.get(target.id) ?? []
    current.push(item)
    byChunkId.set(target.id, current)
  }

  return { byChunkId, unplaced }
}

function chunkForMultimodalItem(
  chunks: DocumentRevisionChunk[],
  item: KnowledgeFsDocumentMultimodalItemResponse,
) {
  const offset = item.start_offset
  if (offset !== null && offset !== undefined) {
    const containing = chunks.find(
      (chunk) =>
        chunk.startOffset !== undefined &&
        chunk.endOffset !== undefined &&
        offset >= chunk.startOffset &&
        offset < chunk.endOffset,
    )
    if (containing) return containing

    const following = chunks
      .filter((chunk) => chunk.startOffset !== undefined && chunk.startOffset >= offset)
      .sort((left, right) => left.startOffset! - right.startOffset!)[0]
    if (following) return following

    const preceding = chunks
      .filter((chunk) => chunk.endOffset !== undefined && chunk.endOffset <= offset)
      .sort((left, right) => right.endOffset! - left.endOffset!)[0]
    if (preceding) return preceding
  }

  const sectionPath = normalizedSectionPath(item.section_path ?? [])
  if (!sectionPath.length) return undefined
  return chunks.find(
    (chunk) =>
      sectionPathKey(normalizedSectionPath(chunk.sectionPath)) === sectionPathKey(sectionPath),
  )
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

export function buildDocumentChunkTree(
  chunks: DocumentRevisionChunk[],
  outlineNodes: KnowledgeFsDocumentOutlineNodeResponse[] = [],
): DocumentChunkTree {
  const sortedChunks = [...chunks].sort(compareChunks)
  if (outlineNodes.length) {
    const outlineTree = buildOutlineBackedChunkTree(sortedChunks, outlineNodes)
    if (outlineTree.roots.length) return outlineTree
  }
  return buildChunkDerivedTree(sortedChunks)
}

function buildChunkDerivedTree(sortedChunks: DocumentRevisionChunk[]): DocumentChunkTree {
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
    const contentLabel = chunk.text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean)
    const node = {
      children: [],
      chunk,
      id: chunk.id,
      label: contentLabel || `#${chunk.ordinal + 1}`,
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
  return {
    byId,
    chunksById,
    displayChunks: sortedChunks,
    outlineNodesByChunkId: new Map(),
    outlineSummaryChunkIds: new Set(),
    roots,
  }
}

function buildOutlineBackedChunkTree(
  sortedChunks: DocumentRevisionChunk[],
  sourceRoots: KnowledgeFsDocumentOutlineNodeResponse[],
): DocumentChunkTree {
  const outlineRoots = coalesceDuplicateOutlineRoots(sourceRoots)
  const allOutlineNodes = flattenOutlineNodes(sourceRoots)
  const outlineTitleKeys = new Set(allOutlineNodes.map((node) => comparableTitle(node.title)))
  const outlinePathKeys = new Set(
    allOutlineNodes
      .map((node) => normalizedSectionPath(node.section_path ?? []))
      .filter((path) => path.length)
      .map(sectionPathKey),
  )
  const firstOrdinal = sortedChunks[0]?.ordinal
  const displayChunks = sortedChunks.filter(
    (chunk) =>
      !isLegacyDocumentTitleChunk(chunk, firstOrdinal, outlineTitleKeys) &&
      !isStructuralOutlineChunk(chunk, outlinePathKeys),
  )
  const chunksById = new Map(displayChunks.map((chunk) => [chunk.id, chunk]))
  const chunksBySection = new Map<string, DocumentRevisionChunk[]>()
  const firstChunkBySectionPrefix = new Map<string, DocumentRevisionChunk>()
  for (const chunk of displayChunks) {
    const sectionPath = normalizedSectionPath(chunk.sectionPath)
    if (!sectionPath.length) continue
    const key = sectionPathKey(sectionPath)
    const sectionChunks = chunksBySection.get(key) ?? []
    sectionChunks.push(chunk)
    chunksBySection.set(key, sectionChunks)
    for (let depth = 1; depth <= sectionPath.length; depth++) {
      const prefixKey = sectionPathKey(sectionPath.slice(0, depth))
      if (!firstChunkBySectionPrefix.has(prefixKey)) firstChunkBySectionPrefix.set(prefixKey, chunk)
    }
  }

  const byId = new Map<string, DocumentChunkTreeNode>()
  const matchedChunkIds = new Set<string>()
  const outlineNodesByChunkId = new Map<string, KnowledgeFsDocumentOutlineNodeResponse>()
  const outlineSummaryChunkIds = new Set<string>()

  const buildNode = (
    outlineNode: KnowledgeFsDocumentOutlineNodeResponse,
    parentId?: string,
    parentPath: string[] = [],
  ): DocumentChunkTreeNode | undefined => {
    const explicitPath = normalizedSectionPath(outlineNode.section_path ?? [])
    const path = explicitPath.length ? explicitPath : [...parentPath, outlineNode.title.trim()]
    const exactChunks = chunksBySection.get(sectionPathKey(path)) ?? []
    for (const chunk of exactChunks) {
      matchedChunkIds.add(chunk.id)
      if (!outlineNodesByChunkId.has(chunk.id)) outlineNodesByChunkId.set(chunk.id, outlineNode)
    }
    if (outlineNode.summary?.trim() && exactChunks[0]) outlineSummaryChunkIds.add(exactChunks[0].id)

    const children = (outlineNode.children ?? []).flatMap((child) => {
      const node = buildNode(child, outlineNode.id, path)
      return node ? [node] : []
    })
    const descendantChunk = firstChunkBySectionPrefix.get(sectionPathKey(path))
    const chunk = exactChunks[0] ?? children[0]?.chunk ?? descendantChunk
    if (!chunk) return undefined

    const node = {
      children,
      chunk,
      id: outlineNode.id,
      label: outlineNode.title,
      outlineNode,
      ...(parentId ? { parentId } : {}),
      targetChunkId: chunk.id,
    } satisfies DocumentChunkTreeNode
    byId.set(node.id, node)
    return node
  }

  const roots = outlineRoots.flatMap((outlineNode) => {
    const node = buildNode(outlineNode)
    return node ? [node] : []
  })
  const unmatchedChunks = displayChunks.filter((chunk) => !matchedChunkIds.has(chunk.id))
  if (unmatchedChunks.length) {
    const fallbackTree = buildChunkDerivedTree(unmatchedChunks)
    for (const [id, node] of fallbackTree.byId) if (!byId.has(id)) byId.set(id, node)
    roots.push(
      ...fallbackTree.roots.filter((node) => !byId.has(node.id) || byId.get(node.id) === node),
    )
  }

  return {
    byId,
    chunksById,
    displayChunks,
    outlineNodesByChunkId,
    outlineSummaryChunkIds,
    roots,
  }
}

function isLegacyDocumentTitleChunk(
  chunk: DocumentRevisionChunk,
  firstOrdinal: number | undefined,
  outlineTitleKeys: ReadonlySet<string>,
) {
  return (
    chunk.ordinal === firstOrdinal &&
    !chunk.parentChunkId &&
    !normalizedSectionPath(chunk.sectionPath).length &&
    !chunk.text.includes('\n') &&
    outlineTitleKeys.has(comparableTitle(chunk.text))
  )
}

function isStructuralOutlineChunk(
  chunk: DocumentRevisionChunk,
  outlinePathKeys: ReadonlySet<string>,
) {
  if (chunk.kind !== 'chunk') return false
  const sectionPath = normalizedSectionPath(chunk.sectionPath)
  const title = sectionPath.at(-1)
  return Boolean(
    title &&
    outlinePathKeys.has(sectionPathKey(sectionPath)) &&
    comparableTitle(chunk.text) === comparableTitle(title),
  )
}

function normalizedSectionPath(sectionPath: readonly string[]) {
  return sectionPath.map((segment) => segment.trim()).filter(Boolean)
}

function sectionPathKey(sectionPath: readonly string[]) {
  return JSON.stringify(normalizedSectionPath(sectionPath))
}

function flattenOutlineNodes(nodes: readonly KnowledgeFsDocumentOutlineNodeResponse[]) {
  const flattened: KnowledgeFsDocumentOutlineNodeResponse[] = []
  const pending = [...nodes].reverse()
  while (pending.length) {
    const node = pending.pop()!
    flattened.push(node)
    for (const child of [...(node.children ?? [])].reverse()) pending.push(child)
  }
  return flattened
}

function comparableTitle(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function coalesceDuplicateOutlineRoots(nodes: readonly KnowledgeFsDocumentOutlineNodeResponse[]) {
  const branchTitleKeys = new Set(
    nodes
      .filter((node) => (node.children?.length ?? 0) > 0)
      .map((node) => comparableTitle(node.title)),
  )
  return nodes.filter(
    (node) => (node.children?.length ?? 0) > 0 || !branchTitleKeys.has(comparableTitle(node.title)),
  )
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
  const heading = chunk.sectionPath.at(-1)?.trim() ?? ''
  let body = chunk.text
  if (heading) {
    const firstLineEnd = body.search(/\r?\n/)
    const firstLine = firstLineEnd >= 0 ? body.slice(0, firstLineEnd) : body
    if (firstLine.normalize('NFKC').trim() === heading.normalize('NFKC').trim()) {
      body = firstLineEnd >= 0 ? body.slice(firstLineEnd).replace(/^(?:\r?\n)+/, '') : ''
    }
  }
  return {
    body,
    heading,
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

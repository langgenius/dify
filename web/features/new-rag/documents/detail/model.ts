import type {
  KnowledgeFsDocumentMultimodalItemResponse,
  KnowledgeFsDocumentOutlineNodeResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { DocumentRevisionChunk, LogicalDocument, LogicalDocumentRevision } from '../models'

export type DocumentChunkTreeNode = {
  children: DocumentChunkTreeNode[]
  id: string
  label: string
  parentId?: string
  targetChunkId: string
}

export type DocumentChunkTree = {
  byId: Map<string, DocumentChunkTreeNode>
  roots: DocumentChunkTreeNode[]
}

export type DocumentContentBlock = {
  body: string
  chunk: DocumentRevisionChunk
  heading?: {
    level: number
    text?: string
  }
  markerLabel?: string
  summary?: string
}

export type DocumentDetailModel = {
  contentBlocks: DocumentContentBlock[]
  contentBlocksByChunkId: Map<string, DocumentContentBlock>
  indexChunks: DocumentRevisionChunk[]
  sourceChunks: DocumentRevisionChunk[]
  sourceChunksById: Map<string, DocumentRevisionChunk>
  tree: DocumentChunkTree
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
    let following: DocumentRevisionChunk | undefined
    let preceding: DocumentRevisionChunk | undefined
    for (const chunk of chunks) {
      if (
        chunk.startOffset !== undefined &&
        chunk.endOffset !== undefined &&
        offset >= chunk.startOffset &&
        offset < chunk.endOffset
      )
        return chunk
      if (
        chunk.startOffset !== undefined &&
        chunk.startOffset >= offset &&
        (!following || chunk.startOffset < following.startOffset!)
      )
        following = chunk
      if (
        chunk.endOffset !== undefined &&
        chunk.endOffset <= offset &&
        (!preceding || chunk.endOffset > preceding.endOffset!)
      )
        preceding = chunk
    }
    if (following) return following
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

export function buildDocumentDetailModel(
  chunks: DocumentRevisionChunk[],
  outlineNodes: KnowledgeFsDocumentOutlineNodeResponse[] = [],
  multimodalItems: KnowledgeFsDocumentMultimodalItemResponse[] = [],
): DocumentDetailModel {
  const sortedChunks = [...chunks].sort(compareChunks)
  const renderedImageElementIds = new Set(
    multimodalItems.flatMap((item) =>
      item.modality === 'image' && item.parse_element_id ? [item.parse_element_id] : [],
    ),
  )
  const indexOnlyChunkIds = new Set(
    sortedChunks
      .filter((chunk) => isRenderedMultimodalIndexChunk(chunk, renderedImageElementIds))
      .map((chunk) => chunk.id),
  )
  const contentChunks = sortedChunks.filter((chunk) => !indexOnlyChunkIds.has(chunk.id))
  if (outlineNodes.length) {
    const outlineModel = buildOutlineBackedDocumentModel(
      sortedChunks,
      contentChunks,
      outlineNodes,
      indexOnlyChunkIds,
    )
    if (outlineModel.tree.roots.length) return outlineModel
  }
  return buildChunkDerivedDocumentModel(sortedChunks, contentChunks, indexOnlyChunkIds)
}

function buildChunkDerivedDocumentModel(
  sourceChunks: DocumentRevisionChunk[],
  contentChunks: DocumentRevisionChunk[],
  indexOnlyChunkIds: ReadonlySet<string>,
): DocumentDetailModel {
  const tree = buildChunkDerivedTree(contentChunks)
  return createDocumentDetailModel(sourceChunks, contentChunks, tree, { indexOnlyChunkIds })
}

function isRenderedMultimodalIndexChunk(
  chunk: DocumentRevisionChunk,
  renderedImageElementIds: ReadonlySet<string>,
) {
  if (chunk.kind !== 'image') return false
  return chunk.parseElementIds.some((elementId) => renderedImageElementIds.has(elementId))
}

function buildChunkDerivedTree(sortedChunks: DocumentRevisionChunk[]): DocumentChunkTree {
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

  const chunksById = new Map(sortedChunks.map((chunk) => [chunk.id, chunk]))
  const compareNodes = (left: DocumentChunkTreeNode, right: DocumentChunkTreeNode) =>
    compareChunks(chunksById.get(left.targetChunkId)!, chunksById.get(right.targetChunkId)!)
  for (const node of byId.values()) node.children.sort(compareNodes)
  roots.sort(compareNodes)
  return { byId, roots }
}

function buildOutlineBackedDocumentModel(
  sourceChunks: DocumentRevisionChunk[],
  visibleChunks: DocumentRevisionChunk[],
  sourceRoots: KnowledgeFsDocumentOutlineNodeResponse[],
  indexOnlyChunkIds: ReadonlySet<string>,
): DocumentDetailModel {
  const outlineRoots = coalesceDuplicateOutlineRoots(sourceRoots)
  const allOutlineNodes = flattenOutlineNodes(sourceRoots)
  const outlineTitleKeys = new Set(allOutlineNodes.map((node) => comparableTitle(node.title)))
  const firstOrdinal = visibleChunks[0]?.ordinal
  const contentChunks = visibleChunks.filter(
    (chunk) => !isLegacyDocumentTitleChunk(chunk, firstOrdinal, outlineTitleKeys),
  )
  const contentChunksById = new Map(contentChunks.map((chunk) => [chunk.id, chunk]))
  const chunksBySection = new Map<string, DocumentRevisionChunk[]>()
  const firstChunkBySectionPrefix = new Map<string, DocumentRevisionChunk>()
  for (const chunk of contentChunks) {
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
  const summariesByChunkId = new Map<string, string>()

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
    const summary = outlineNode.summary?.trim()
    if (summary && exactChunks[0]) summariesByChunkId.set(exactChunks[0].id, summary)

    const children = (outlineNode.children ?? []).flatMap((child) => {
      const node = buildNode(child, outlineNode.id, path)
      return node ? [node] : []
    })
    const descendantChunk = firstChunkBySectionPrefix.get(sectionPathKey(path))
    const childChunk = children[0] ? contentChunksById.get(children[0].targetChunkId) : undefined
    const chunk = exactChunks[0] ?? childChunk ?? descendantChunk
    if (!chunk) return undefined

    const node = {
      children,
      id: outlineNode.id,
      label: outlineNode.title,
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
  const unmatchedChunks = contentChunks.filter((chunk) => !matchedChunkIds.has(chunk.id))
  if (unmatchedChunks.length) {
    const fallbackTree = buildChunkDerivedTree(unmatchedChunks)
    for (const [id, node] of fallbackTree.byId) if (!byId.has(id)) byId.set(id, node)
    roots.push(
      ...fallbackTree.roots.filter((node) => !byId.has(node.id) || byId.get(node.id) === node),
    )
  }

  return createDocumentDetailModel(
    sourceChunks,
    contentChunks,
    { byId, roots },
    {
      indexOnlyChunkIds,
      outlineNodesByChunkId,
      summariesByChunkId,
    },
  )
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

function createDocumentDetailModel(
  sourceChunks: DocumentRevisionChunk[],
  contentChunks: DocumentRevisionChunk[],
  tree: DocumentChunkTree,
  options: {
    indexOnlyChunkIds: ReadonlySet<string>
    outlineNodesByChunkId?: ReadonlyMap<string, KnowledgeFsDocumentOutlineNodeResponse>
    summariesByChunkId?: ReadonlyMap<string, string>
  },
): DocumentDetailModel {
  const firstChunkIdBySection = new Map<string, string>()
  for (const chunk of contentChunks) {
    const sectionPath = normalizedSectionPath(chunk.sectionPath)
    if (!sectionPath.length) continue
    const key = sectionPathKey(sectionPath)
    if (!firstChunkIdBySection.has(key)) firstChunkIdBySection.set(key, chunk.id)
  }

  const contentBlocks: DocumentContentBlock[] = contentChunks.map((chunk) => {
    const content = chunkContentParts(chunk)
    const sectionPath = normalizedSectionPath(chunk.sectionPath)
    const ownsSectionHeading =
      !sectionPath.length || firstChunkIdBySection.get(sectionPathKey(sectionPath)) === chunk.id
    const outlineNode = options.outlineNodesByChunkId?.get(chunk.id)
    const headingText = outlineNode?.title.trim() || content.heading || undefined
    return {
      body: content.body,
      chunk,
      ...(ownsSectionHeading
        ? {
            heading: {
              level: outlineNode?.level ?? (sectionPath.length || 2),
              ...(headingText ? { text: headingText } : {}),
            },
          }
        : {}),
      ...(options.summariesByChunkId?.get(chunk.id)
        ? { summary: options.summariesByChunkId.get(chunk.id) }
        : {}),
    } satisfies DocumentContentBlock
  })

  const parentChunkIds = new Set(
    contentChunks.flatMap((chunk) => (chunk.parentChunkId ? [chunk.parentChunkId] : [])),
  )
  const contentChunkIds = new Set(contentChunks.map((chunk) => chunk.id))
  const indexChunks = sourceChunks.filter((chunk) => {
    if (options.indexOnlyChunkIds.has(chunk.id)) return true
    if (!contentChunkIds.has(chunk.id)) return false
    const content = chunkContentParts(chunk)
    return content.body || !chunk.text
  })
  const indexChunkIds = new Set(indexChunks.map((chunk) => chunk.id))
  const positionsByParent = new Map<string, number>()
  for (const block of contentBlocks) {
    if (!indexChunkIds.has(block.chunk.id) || parentChunkIds.has(block.chunk.id)) continue
    const parentId = block.chunk.parentChunkId ?? ''
    const position = (positionsByParent.get(parentId) ?? 0) + 1
    positionsByParent.set(parentId, position)
    block.markerLabel = `C-${position}`
  }

  return {
    contentBlocks,
    contentBlocksByChunkId: new Map(contentBlocks.map((block) => [block.chunk.id, block])),
    indexChunks,
    sourceChunks,
    sourceChunksById: new Map(sourceChunks.map((chunk) => [chunk.id, chunk])),
    tree,
  }
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

import type { BlockEnum } from '../../types'

export type VibeCommandDetail = {
  dsl?: string
}

export type ParsedNodeDraft = {
  id: string
  type?: BlockEnum
  title?: string
  toolKey?: string
}

export type ParsedNode = {
  id: string
  type: BlockEnum
  title?: string
  toolKey?: string
}

export type ParsedEdge = {
  sourceId: string
  targetId: string
  label?: string
}

export type ParseError = {
  error: 'invalidMermaid' | 'missingNodeType' | 'unknownNodeType' | 'unknownTool' | 'missingNodeDefinition' | 'unknownNodeId' | 'unsupportedEdgeLabel'
  detail?: string
}

export type ParseResult = {
  nodes: ParsedNode[]
  edges: ParsedEdge[]
}

import type { Edge, Node } from '../types'

const WORKFLOW_CLIPBOARD_VERSION = 1
const WORKFLOW_CLIPBOARD_KIND = 'dify-workflow-clipboard'

type WorkflowClipboardPayload = {
  kind: string
  version: number
  nodes: Node[]
  edges: Edge[]
}

export type WorkflowClipboardData = {
  nodes: Node[]
  edges: Edge[]
}

export type WorkflowClipboardReadResult = WorkflowClipboardData & {
  sourceVersion?: number
  isVersionMismatch: boolean
}

const emptyClipboardData: WorkflowClipboardData = {
  nodes: [],
  edges: [],
}

const emptyClipboardReadResult: WorkflowClipboardReadResult = {
  ...emptyClipboardData,
  isVersionMismatch: false,
}

const isNodeArray = (value: unknown): value is Node[] => Array.isArray(value)
const isEdgeArray = (value: unknown): value is Edge[] => Array.isArray(value)

export const parseWorkflowClipboardText = (text: string): WorkflowClipboardReadResult => {
  if (!text)
    return emptyClipboardReadResult

  try {
    const parsed = JSON.parse(text) as Partial<WorkflowClipboardPayload>
    if (
      parsed.kind !== WORKFLOW_CLIPBOARD_KIND
      || typeof parsed.version !== 'number'
      || !isNodeArray(parsed.nodes)
      || !isEdgeArray(parsed.edges)
    ) {
      return emptyClipboardReadResult
    }

    const sourceVersion = parsed.version

    return {
      nodes: parsed.nodes,
      edges: parsed.edges,
      sourceVersion,
      isVersionMismatch: sourceVersion !== WORKFLOW_CLIPBOARD_VERSION,
    }
  }
  catch {
    return emptyClipboardReadResult
  }
}

export const stringifyWorkflowClipboardData = (payload: WorkflowClipboardData): string => {
  const data: WorkflowClipboardPayload = {
    kind: WORKFLOW_CLIPBOARD_KIND,
    version: WORKFLOW_CLIPBOARD_VERSION,
    nodes: payload.nodes,
    edges: payload.edges,
  }

  return JSON.stringify(data)
}

export const writeWorkflowClipboard = async (payload: WorkflowClipboardData): Promise<void> => {
  const text = stringifyWorkflowClipboardData(payload)
  await navigator.clipboard.writeText(text)
}

export const readWorkflowClipboard = async (): Promise<WorkflowClipboardReadResult> => {
  try {
    const text = await navigator.clipboard.readText()
    return parseWorkflowClipboardText(text)
  }
  catch {
    return emptyClipboardReadResult
  }
}

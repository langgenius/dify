import type { Edge, Node } from '../types'
import { writeTextToClipboard } from '@/utils/clipboard'

const WORKFLOW_CLIPBOARD_DATA_TYPE = 'dify/workflow'
const WORKFLOW_CLIPBOARD_DATA_VERSION = 1

export type WorkflowClipboardData = {
  dataType: typeof WORKFLOW_CLIPBOARD_DATA_TYPE
  version: typeof WORKFLOW_CLIPBOARD_DATA_VERSION
  nodes: Node[]
  relatedNodes?: Node[]
  relatedEdges?: Edge[]
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const serializeWorkflowClipboardData = (
  data: Omit<WorkflowClipboardData, 'dataType' | 'version'>,
): string => {
  return JSON.stringify({
    dataType: WORKFLOW_CLIPBOARD_DATA_TYPE,
    version: WORKFLOW_CLIPBOARD_DATA_VERSION,
    ...data,
  })
}

export const parseWorkflowClipboardData = (
  text: string,
): WorkflowClipboardData | null => {
  if (!text)
    return null

  try {
    const parsed = JSON.parse(text) as unknown

    if (!isObject(parsed))
      return null
    if (parsed.dataType !== WORKFLOW_CLIPBOARD_DATA_TYPE)
      return null
    if (parsed.version !== WORKFLOW_CLIPBOARD_DATA_VERSION)
      return null
    if (!Array.isArray(parsed.nodes))
      return null
    if (parsed.relatedNodes !== undefined && !Array.isArray(parsed.relatedNodes))
      return null
    if (parsed.relatedEdges !== undefined && !Array.isArray(parsed.relatedEdges))
      return null

    return parsed as WorkflowClipboardData
  }
  catch {
    return null
  }
}

export const writeWorkflowClipboardData = async (
  data: Omit<WorkflowClipboardData, 'dataType' | 'version'>,
): Promise<void> => {
  await writeTextToClipboard(serializeWorkflowClipboardData(data))
}

export const readWorkflowClipboardData = async (): Promise<WorkflowClipboardData | null> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText)
    return null

  try {
    const text = await navigator.clipboard.readText()
    return parseWorkflowClipboardData(text)
  }
  catch {
    return null
  }
}
